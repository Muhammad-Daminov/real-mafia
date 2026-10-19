import { EventEmitter } from 'events';
import { requestLoggerMiddleware } from './request-logger.middleware';

function buildRes() {
  const emitter = new EventEmitter() as EventEmitter & { statusCode: number; setHeader: jest.Mock };
  emitter.statusCode = 200;
  emitter.setHeader = jest.fn();
  return emitter;
}

describe('requestLoggerMiddleware', () => {
  it('attaches a requestId to the request and echoes it as a response header', () => {
    const req = { method: 'GET', path: '/health' } as Parameters<typeof requestLoggerMiddleware>[0];
    const res = buildRes();
    const next = jest.fn();

    requestLoggerMiddleware(req, res as never, next);

    expect(req.requestId).toBeDefined();
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a distinct id per call, never reusing one across requests', () => {
    const req1 = { method: 'GET', path: '/health' } as Parameters<typeof requestLoggerMiddleware>[0];
    const req2 = { method: 'GET', path: '/health' } as Parameters<typeof requestLoggerMiddleware>[0];

    requestLoggerMiddleware(req1, buildRes() as never, jest.fn());
    requestLoggerMiddleware(req2, buildRes() as never, jest.fn());

    expect(req1.requestId).not.toBe(req2.requestId);
  });

  it('calls next() synchronously without waiting on the response', () => {
    const req = { method: 'POST', path: '/rooms' } as Parameters<typeof requestLoggerMiddleware>[0];
    const res = buildRes();
    const next = jest.fn();

    requestLoggerMiddleware(req, res as never, next);

    expect(next).toHaveBeenCalled();
    // The finish listener is registered but not yet fired — proves this
    // middleware doesn't block the request waiting on the response.
    expect(res.listenerCount('finish')).toBe(1);
  });
});
