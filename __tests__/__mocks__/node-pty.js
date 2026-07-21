// node-pty mock
const mockPtyProcess = {
  onData: jest.fn(),
  onExit: jest.fn(),
  write: jest.fn(),
  kill: jest.fn(),
  pid: 12345
};

module.exports = {
  spawn: jest.fn().mockReturnValue(mockPtyProcess),
  mockPtyProcess
};
