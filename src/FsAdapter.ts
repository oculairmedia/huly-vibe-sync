import fs from 'node:fs';

export class FsAdapter {
  readFile(p: string, encoding: BufferEncoding): string {
    return fs.readFileSync(p, encoding);
  }

  stat(p: string): fs.Stats {
    return fs.statSync(p);
  }

  exists(p: string): boolean {
    return fs.existsSync(p);
  }

  readdir(p: string): string[] {
    return fs.readdirSync(p) as string[];
  }
}
