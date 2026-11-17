import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = process.cwd()
const source = resolve(root, "src/desktop/renderer/assets/cmc_logo.jpg")
const output = resolve(root, "build")
const iconsetNames: ReadonlyArray<readonly [size: number, filename: string]> = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
]
const icoSizes: readonly number[] = [16, 32, 48, 64, 128, 256]

const temporaryDirectory = await mkdtemp(join(tmpdir(), "ccodex-icons-"))
const iconset = join(temporaryDirectory, "cmc.iconset")
const icoPngs = join(temporaryDirectory, "ico")

try {
  await mkdir(iconset)
  await mkdir(icoPngs)
  await mkdir(output, { recursive: true })

  for (const [size, name] of iconsetNames) {
    execFileSync("sips", ["-s", "format", "png", "-z", String(size), String(size), source, "--out", join(iconset, name)], { stdio: "ignore" })
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(output, "cmc_logo.icns")], { stdio: "inherit" })

  const pngImages: Array<{ size: number; data: Buffer }> = []
  for (const size of icoSizes) {
    const path = join(icoPngs, `${size}.png`)
    execFileSync("sips", ["-s", "format", "png", "-z", String(size), String(size), source, "--out", path], { stdio: "ignore" })
    pngImages.push({ size, data: await readFile(path) })
  }

  const header = Buffer.alloc(6 + 16 * pngImages.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngImages.length, 4)
  let offset = header.length
  pngImages.forEach(({ size, data }, index) => {
    const entryOffset = 6 + 16 * index
    header.writeUInt8(size === 256 ? 0 : size, entryOffset)
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
    header.writeUInt16LE(1, entryOffset + 4)
    header.writeUInt16LE(32, entryOffset + 6)
    header.writeUInt32LE(data.length, entryOffset + 8)
    header.writeUInt32LE(offset, entryOffset + 12)
    offset += data.length
  })
  await writeFile(join(output, "cmc_logo.ico"), Buffer.concat([header, ...pngImages.map(({ data }) => data)]))
  console.log("Generated build/cmc_logo.icns and build/cmc_logo.ico")
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
