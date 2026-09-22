import { readdir, readFile, writeFile, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Run once during image creation, keeping originals for non-gzip clients.
async function compressDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await compressDirectory(path);
    } else if (/\.(js|css|html|svg|json|txt|xml)$/.test(entry.name)) {
      const source = await readFile(path);
      if (source.length < 512) continue;
      const compressed = gzipSync(source, { level: 9 });
      if (compressed.length >= source.length) continue;
      await writeFile(`${path}.gz`, compressed);
      const metadata = await stat(path);
      await utimes(`${path}.gz`, metadata.atime, metadata.mtime);
    }
  }
}

await compressDirectory(process.argv[2] || "dist");
