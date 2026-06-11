import Foundation

/// Writes one line of the stdout protocol consumed by backend-process.js.
/// Exits quietly if the pipe to Electron has closed, mirroring the
/// OSError handling in the Windows backend.
func emit(_ line: String) {
    print(line)
    fflush(stdout)
    if ferror(stdout) != 0 {
        exit(0)
    }
}
