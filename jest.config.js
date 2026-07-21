module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.js'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/__tests__/__mocks__/electron.js',
    '^node-pty$': '<rootDir>/__tests__/__mocks__/node-pty.js',
    '^xterm$': '<rootDir>/__tests__/__mocks__/xterm.js',
    '^@xterm/addon-fit$': '<rootDir>/__tests__/__mocks__/xterm-addon-fit.js',
    '^@xterm/addon-serialize$': '<rootDir>/__tests__/__mocks__/xterm-addon-serialize.js'
  }
};
