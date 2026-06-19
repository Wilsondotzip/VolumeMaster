import AppKit
import Foundation

/// Renders a file's Finder icon as PNG on stdout (`--app-icon <path>`).
/// Used by the Electron app instead of app.getFileIcon, which crashes the
/// main process on recent macOS versions.
enum IconTool {
    static func writePNG(for filePath: String, pixels: Int = 64) -> Int32 {
        let icon = NSWorkspace.shared.icon(forFile: filePath)

        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixels,
            pixelsHigh: pixels,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else { return 1 }
        rep.size = NSSize(width: pixels, height: pixels)

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        icon.draw(
            in: NSRect(x: 0, y: 0, width: pixels, height: pixels),
            from: .zero,
            operation: .copy,
            fraction: 1.0
        )
        NSGraphicsContext.restoreGraphicsState()

        guard let png = rep.representation(using: .png, properties: [:]) else { return 1 }
        FileHandle.standardOutput.write(png)
        return 0
    }
}
