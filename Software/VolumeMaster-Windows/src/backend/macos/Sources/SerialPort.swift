import Foundation

/// POSIX serial port with line-based reads, equivalent to pyserial usage
/// in the Windows backend.
final class SerialPort {
    enum OpenError: Error {
        case notFound
        case busy
        case other(String)
    }

    enum ReadError: Error {
        case disconnected
    }

    private(set) var fd: Int32 = -1
    private var buffer = Data()

    var isOpen: Bool { fd >= 0 }

    func open(path: String, baudrate: Int, bytesize: Int, parity: String, stopbits: Int) throws {
        fd = Darwin.open(path, O_RDWR | O_NOCTTY | O_NONBLOCK)
        if fd < 0 {
            let err = errno
            switch err {
            case ENOENT, ENXIO, ENODEV:
                throw OpenError.notFound
            case EBUSY, EACCES, EPERM:
                throw OpenError.busy
            default:
                throw OpenError.other(String(cString: strerror(err)))
            }
        }

        // Claim exclusive access so two backends can't fight over one device
        _ = ioctl(fd, TIOCEXCL)

        var tty = termios()
        if tcgetattr(fd, &tty) != 0 {
            let message = String(cString: strerror(errno))
            close()
            throw OpenError.other(message)
        }

        cfmakeraw(&tty)
        cfsetspeed(&tty, speed_t(baudrate))

        tty.c_cflag |= tcflag_t(CLOCAL | CREAD)

        tty.c_cflag &= ~tcflag_t(CSIZE)
        switch bytesize {
        case 5: tty.c_cflag |= tcflag_t(CS5)
        case 6: tty.c_cflag |= tcflag_t(CS6)
        case 7: tty.c_cflag |= tcflag_t(CS7)
        default: tty.c_cflag |= tcflag_t(CS8)
        }

        switch parity.uppercased() {
        case "E":
            tty.c_cflag |= tcflag_t(PARENB)
            tty.c_cflag &= ~tcflag_t(PARODD)
        case "O":
            tty.c_cflag |= tcflag_t(PARENB | PARODD)
        default:
            tty.c_cflag &= ~tcflag_t(PARENB)
        }

        if stopbits == 2 {
            tty.c_cflag |= tcflag_t(CSTOPB)
        } else {
            tty.c_cflag &= ~tcflag_t(CSTOPB)
        }

        if tcsetattr(fd, TCSANOW, &tty) != 0 {
            let message = String(cString: strerror(errno))
            close()
            throw OpenError.other(message)
        }

        tcflush(fd, TCIOFLUSH)
        buffer.removeAll()
    }

    /// Waits up to `timeoutMs` for data and returns any complete lines received.
    /// Throws ReadError.disconnected when the device goes away (USB unplug).
    func readLines(timeoutMs: Int32) throws -> [String] {
        guard isOpen else { throw ReadError.disconnected }

        var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let result = poll(&pfd, 1, timeoutMs)
        if result < 0 {
            if errno == EINTR { return [] }
            throw ReadError.disconnected
        }
        if result == 0 { return [] }

        if pfd.revents & Int16(POLLHUP | POLLERR | POLLNVAL) != 0 {
            throw ReadError.disconnected
        }

        var chunk = [UInt8](repeating: 0, count: 1024)
        let n = read(fd, &chunk, chunk.count)
        if n < 0 {
            if errno == EAGAIN || errno == EINTR { return [] }
            throw ReadError.disconnected
        }
        if n == 0 {
            throw ReadError.disconnected
        }
        buffer.append(contentsOf: chunk[0..<n])

        var lines: [String] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer.subdata(in: buffer.startIndex..<newline)
            buffer.removeSubrange(buffer.startIndex...newline)
            if let line = String(data: lineData, encoding: .utf8) {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { lines.append(trimmed) }
            }
        }
        return lines
    }

    func close() {
        if fd >= 0 {
            Darwin.close(fd)
            fd = -1
        }
        buffer.removeAll()
    }
}
