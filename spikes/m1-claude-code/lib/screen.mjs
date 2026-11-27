// Minimal terminal screen model: enough of VT100/xterm to turn a TUI's output
// stream into the text a user would see. Colours and styles are dropped.
export class Screen {
  constructor(cols = 120, rows = 40) {
    this.cols = cols;
    this.rows = rows;
    this.clear();
  }

  clear() {
    this.lines = Array.from({ length: this.rows }, () => Array(this.cols).fill(' '));
    this.x = 0;
    this.y = 0;
  }

  resize(cols, rows) {
    const old = this.lines;
    this.cols = cols;
    this.rows = rows;
    this.lines = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => old[r]?.[c] ?? ' '),
    );
    this.x = Math.min(this.x, cols - 1);
    this.y = Math.min(this.y, rows - 1);
  }

  scroll() {
    this.lines.shift();
    this.lines.push(Array(this.cols).fill(' '));
  }

  put(ch) {
    if (this.x >= this.cols) {
      this.x = 0;
      this.lf();
    }
    this.lines[this.y][this.x] = ch;
    this.x++;
  }

  lf() {
    if (this.y === this.rows - 1) this.scroll();
    else this.y++;
  }

  eraseLine(mode) {
    const line = this.lines[this.y];
    const [from, to] =
      mode === 1 ? [0, this.x + 1] : mode === 2 ? [0, this.cols] : [this.x, this.cols];
    for (let i = from; i < to && i < this.cols; i++) line[i] = ' ';
  }

  eraseDisplay(mode) {
    if (mode === 2 || mode === 3) {
      for (const line of this.lines) line.fill(' ');
      return;
    }
    if (mode === 1) {
      for (let r = 0; r < this.y; r++) this.lines[r].fill(' ');
      this.eraseLine(1);
      return;
    }
    this.eraseLine(0);
    for (let r = this.y + 1; r < this.rows; r++) this.lines[r].fill(' ');
  }

  csi(params, final, priv) {
    const nums = params.split(';').map((p) => (p === '' ? undefined : Number(p)));
    const n = (i, d = 1) => nums[i] ?? d;
    const clampY = (v) => Math.max(0, Math.min(this.rows - 1, v));
    const clampX = (v) => Math.max(0, Math.min(this.cols - 1, v));
    switch (final) {
      case 'H':
      case 'f':
        this.y = clampY(n(0) - 1);
        this.x = clampX(n(1) - 1);
        break;
      case 'A':
        this.y = clampY(this.y - n(0));
        break;
      case 'B':
        this.y = clampY(this.y + n(0));
        break;
      case 'C':
        this.x = clampX(this.x + n(0));
        break;
      case 'D':
        this.x = clampX(this.x - n(0));
        break;
      case 'E':
        this.y = clampY(this.y + n(0));
        this.x = 0;
        break;
      case 'F':
        this.y = clampY(this.y - n(0));
        this.x = 0;
        break;
      case 'G':
        this.x = clampX(n(0) - 1);
        break;
      case 'd':
        this.y = clampY(n(0) - 1);
        break;
      case 'J':
        this.eraseDisplay(n(0, 0));
        break;
      case 'K':
        this.eraseLine(n(0, 0));
        break;
      case 'X':
        for (let i = 0; i < n(0); i++)
          if (this.x + i < this.cols) this.lines[this.y][this.x + i] = ' ';
        break;
      case 'h':
      case 'l':
        if (priv === '?' && (nums[0] === 1049 || nums[0] === 47 || nums[0] === 1047)) this.clear();
        break;
      default:
        break; // colours (m), scroll regions (r) and modes are ignored
    }
  }

  write(data) {
    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === '\x1b') {
        const next = data[i + 1];
        if (next === '[') {
          let j = i + 2;
          let priv = '';
          if ('?<>='.includes(data[j])) priv = data[j++];
          let params = '';
          while (j < data.length && /[0-9;:]/.test(data[j])) params += data[j++];
          while (j < data.length && /[ -/]/.test(data[j])) j++;
          const final = data[j];
          if (final !== undefined) this.csi(params, final, priv);
          i = j + 1;
        } else if (next === ']' || next === 'P' || next === '_' || next === '^') {
          // OSC / DCS / APC / PM: skip to BEL or ST
          let j = i + 2;
          while (
            j < data.length &&
            data[j] !== '\x07' &&
            !(data[j] === '\x1b' && data[j + 1] === '\\')
          )
            j++;
          i = data[j] === '\x07' ? j + 1 : j + 2;
        } else if (next === '(' || next === ')') {
          i += 3;
        } else {
          if (next === 'c') this.clear();
          i += 2;
        }
        continue;
      }
      if (ch === '\r') this.x = 0;
      else if (ch === '\n') this.lf();
      else if (ch === '\b') this.x = Math.max(0, this.x - 1);
      else if (ch === '\t') this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
      else if (ch >= ' ' && ch !== '\x7f') this.put(ch);
      i++;
    }
  }

  text() {
    return this.lines
      .map((l) => l.join('').trimEnd())
      .join('\n')
      .replace(/\n+$/, '');
  }
}
