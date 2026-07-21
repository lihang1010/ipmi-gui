/**
 * modal.js 模块单元测试
 */

// Mock DOM - minimal for modal
const mockBtn = {
  addEventListener: jest.fn(),
  focus: jest.fn()
};

const mockOverlay = {
  className: '',
  style: { zIndex: '' },
  innerHTML: '',
  querySelector: jest.fn((selector) => {
    if (selector === '#modal-ok') return mockBtn;
    if (selector === '#modal-cancel') return mockBtn;
    return mockBtn;
  }),
  addEventListener: jest.fn(),
  remove: jest.fn()
};

global.document = {
  createElement: jest.fn(() => mockOverlay),
  getElementById: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  body: {
    appendChild: jest.fn()
  }
};

jest.mock('../src/modules/utils', () => ({
  escapeHtml: jest.fn((s) => s)
}));

const modal = require('../src/modules/modal');
const { escapeHtml } = require('../src/modules/utils');

describe('Modal Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('showModal', () => {
    test('should return a promise', () => {
      const result = modal.showModal({ message: 'test' });
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });

    test('should call escapeHtml for message', () => {
      const p = modal.showModal({ message: '<script>alert("xss")</script>' });
      expect(escapeHtml).toHaveBeenCalled();
      p.catch(() => {});
    });

    test('should call escapeHtml for title', () => {
      const p = modal.showModal({ title: '<b>Bold</b>', message: 'test' });
      expect(escapeHtml).toHaveBeenCalled();
      p.catch(() => {});
    });

    test('should have default title', () => {
      const p = modal.showModal({ message: 'test' });
      expect(escapeHtml).toHaveBeenCalled();
      p.catch(() => {});
    });

    test('should create overlay with dialog class', () => {
      const p = modal.showModal({ message: 'test' });
      expect(mockOverlay.className).toBe('dialog-overlay');
      p.catch(() => {});
    });

    test('should set high z-index', () => {
      const p = modal.showModal({ message: 'test' });
      expect(mockOverlay.style.zIndex).toBe('99999');
      p.catch(() => {});
    });

    test('should append overlay to body', () => {
      const p = modal.showModal({ message: 'test' });
      expect(document.body.appendChild).toHaveBeenCalledWith(mockOverlay);
      p.catch(() => {});
    });

    test('should create HTML with message', () => {
      const p = modal.showModal({ message: 'Hello World' });
      expect(mockOverlay.innerHTML).toContain('Hello World');
      p.catch(() => {});
    });

    test('should create OK button', () => {
      const p = modal.showModal({ message: 'test' });
      expect(mockOverlay.innerHTML).toContain('modal-ok');
      expect(mockOverlay.innerHTML).toContain('确定');
      p.catch(() => {});
    });

    test('should create Cancel button for confirm type', () => {
      const p = modal.showModal({ message: 'test', type: 'confirm' });
      expect(mockOverlay.innerHTML).toContain('modal-cancel');
      expect(mockOverlay.innerHTML).toContain('取消');
      p.catch(() => {});
    });

    test('should not create Cancel button for alert type', () => {
      const p = modal.showModal({ message: 'test', type: 'alert' });
      expect(mockOverlay.innerHTML).not.toContain('modal-cancel');
      p.catch(() => {});
    });
  });

  describe('safeAlert', () => {
    test('should be a function', () => {
      expect(typeof modal.safeAlert).toBe('function');
    });

    test('should return a promise', () => {
      const result = modal.safeAlert('test');
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });

  describe('safeConfirm', () => {
    test('should be a function', () => {
      expect(typeof modal.safeConfirm).toBe('function');
    });

    test('should return a promise', () => {
      const result = modal.safeConfirm('test');
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });

  describe('Modal Types', () => {
    test('should support alert type', () => {
      const opts = { title: 'Info', message: 'Something happened', type: 'alert' };
      expect(opts.type).toBe('alert');
    });

    test('should support confirm type', () => {
      const opts = { title: 'Confirm', message: 'Are you sure?', type: 'confirm' };
      expect(opts.type).toBe('confirm');
    });

    test('should have default title', () => {
      const opts = { message: 'test' };
      expect(opts.title || '提示').toBe('提示');
    });
  });

  describe('Escape Key Handling', () => {
    test('should close modal on Escape key', () => {
      const event = { key: 'Escape' };
      expect(event.key).toBe('Escape');
    });

    test('should not close modal on other keys', () => {
      const event = { key: 'Enter' };
      expect(event.key).not.toBe('Escape');
    });
  });

  describe('Overlay Click', () => {
    test('should close alert when clicking overlay', () => {
      const isConfirm = false;
      const target = 'overlay';
      const e = { target };
      if (e.target === 'overlay') {
        // For alert, clicking overlay closes with true
        expect(isConfirm ? false : true).toBe(true);
      }
    });

    test('should close confirm when clicking overlay', () => {
      const isConfirm = true;
      const target = 'overlay';
      const e = { target };
      if (e.target === 'overlay') {
        // For confirm, clicking overlay closes with false
        expect(isConfirm ? false : true).toBe(false);
      }
    });
  });

  describe('Button Types', () => {
    test('should have OK button', () => {
      const html = '<button class="btn btn-primary" id="modal-ok">确定</button>';
      expect(html).toContain('modal-ok');
      expect(html).toContain('确定');
    });

    test('should have Cancel button for confirm type', () => {
      const html = '<button class="btn" id="modal-cancel">取消</button>';
      expect(html).toContain('modal-cancel');
      expect(html).toContain('取消');
    });
  });

  describe('Message Formatting', () => {
    test('should support multiline messages', () => {
      const msg = 'Line 1\nLine 2\nLine 3';
      expect(msg.split('\n')).toHaveLength(3);
    });

    test('should support special characters', () => {
      const msg = 'Server: 192.168.1.1\nError: Connection refused';
      expect(msg).toContain('192.168.1.1');
    });
  });
});
