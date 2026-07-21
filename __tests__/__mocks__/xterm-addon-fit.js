// @xterm/addon-fit mock
module.exports = {
  FitAddon: jest.fn().mockImplementation(() => ({
    fit: jest.fn()
  }))
};
