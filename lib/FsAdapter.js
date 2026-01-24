import fs from 'node:fs';

export class FsAdapter {
  readFile(p, encoding) {
    return fs.readFileSync(p, encoding);
  }

  stat(p) {
    return fs.statSync(p);
  }

  exists(p) {
    return fs.existsSync(p);
  }

  readdir(p, options) {
    return fs.readdirSync(p, options);
  }
}
