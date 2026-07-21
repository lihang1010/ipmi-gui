// xterm mock
class MockTerminal {
  constructor(opts) {
    this.opts = opts;
    this._onData = null;
  }
  open = jest.fn();
  write = jest.fn();
  writeln = jest.fn();
  clear = jest.fn();
  focus = jest.fn();
  blur = jest.fn();
  dispose = jest.fn();
  onData = jest.fn((cb) => { this._onData = cb; });
  loadAddon = jest.fn();
}

module.exports = { Terminal: MockTerminal };
