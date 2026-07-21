// @xterm/addon-serialize mock
module.exports = {
  SerializeAddon: jest.fn().mockImplementation(() => ({
    serialize: jest.fn().mockReturnValue('mock terminal content')
  }))
};
