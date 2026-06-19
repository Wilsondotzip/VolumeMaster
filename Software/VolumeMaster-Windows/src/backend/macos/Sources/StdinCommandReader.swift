import Foundation

/// Non-blocking line reader for commands Electron writes to the backend's
/// stdin (currently just LIST_SESSIONS).
final class StdinCommandReader {
    private var buffer = Data()
    private var closed = false

    init() {
        let flags = fcntl(STDIN_FILENO, F_GETFL)
        _ = fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK)
    }

    /// Waits up to `timeoutMs` for input and returns any complete lines.
    /// Once stdin reaches EOF (Electron exited) it sleeps out the timeout
    /// instead of polling, so callers can use it as a drop-in wait.
    func readLines(timeoutMs: Int32) -> [String] {
        if closed {
            if timeoutMs > 0 {
                Thread.sleep(forTimeInterval: Double(timeoutMs) / 1000)
            }
            return []
        }

        var pfd = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
        let result = poll(&pfd, 1, timeoutMs)
        guard result > 0 else { return [] }

        if pfd.revents & Int16(POLLHUP | POLLERR | POLLNVAL) != 0, pfd.revents & Int16(POLLIN) == 0 {
            closed = true
            return []
        }

        var chunk = [UInt8](repeating: 0, count: 1024)
        let n = read(STDIN_FILENO, &chunk, chunk.count)
        if n < 0 { return [] } // EAGAIN/EINTR
        if n == 0 {
            closed = true
            return []
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
}
