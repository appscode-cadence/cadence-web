import type * as GrpcJs from '@grpc/grpc-js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type * as GrpcServiceModule from '../grpc-service';

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const TLS_ENV_VARS = [
  'CADENCE_GRPC_TLS_CA_FILE',
  'CADENCE_GRPC_TLS_CERT_FILE',
  'CADENCE_GRPC_TLS_KEY_FILE',
] as const;

describe('getChannelCredentials', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-service-test-'));
    TLS_ENV_VARS.forEach((name) => delete process.env[name]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create insecure credentials when no TLS files are configured', () => {
    const { getChannelCredentials, createInsecure, createSsl } = setup();

    expect(getChannelCredentials()).toBe('insecure-credentials');
    expect(createInsecure).toHaveBeenCalledTimes(1);
    expect(createSsl).not.toHaveBeenCalled();
  });

  it('should create one-way TLS credentials when only the CA file is configured', () => {
    process.env.CADENCE_GRPC_TLS_CA_FILE = writeFile(tmpDir, 'ca.pem', 'ca');
    const { getChannelCredentials, createSsl } = setup();

    expect(getChannelCredentials()).toBe('ssl-credentials');
    expect(createSsl).toHaveBeenCalledWith(Buffer.from('ca'), null, null);
  });

  it('should create mutual TLS credentials when the CA, certificate and key files are configured', () => {
    process.env.CADENCE_GRPC_TLS_CA_FILE = writeFile(tmpDir, 'ca.pem', 'ca');
    process.env.CADENCE_GRPC_TLS_CERT_FILE = writeFile(
      tmpDir,
      'tls.crt',
      'cert'
    );
    process.env.CADENCE_GRPC_TLS_KEY_FILE = writeFile(tmpDir, 'tls.key', 'key');
    const { getChannelCredentials, createSsl } = setup();

    expect(getChannelCredentials()).toBe('ssl-credentials');
    expect(createSsl).toHaveBeenCalledWith(
      Buffer.from('ca'),
      Buffer.from('key'),
      Buffer.from('cert')
    );
  });

  it('should use system root CAs when only the client certificate and key are configured', () => {
    process.env.CADENCE_GRPC_TLS_CERT_FILE = writeFile(
      tmpDir,
      'tls.crt',
      'cert'
    );
    process.env.CADENCE_GRPC_TLS_KEY_FILE = writeFile(tmpDir, 'tls.key', 'key');
    const { getChannelCredentials, createSsl } = setup();

    expect(getChannelCredentials()).toBe('ssl-credentials');
    expect(createSsl).toHaveBeenCalledWith(
      null,
      Buffer.from('key'),
      Buffer.from('cert')
    );
  });

  it('should log an error when only one of the certificate and key files is configured', () => {
    process.env.CADENCE_GRPC_TLS_CA_FILE = writeFile(tmpDir, 'ca.pem', 'ca');
    process.env.CADENCE_GRPC_TLS_CERT_FILE = writeFile(
      tmpDir,
      'tls.crt',
      'cert'
    );
    const { getChannelCredentials, createSsl, logger } = setup();

    expect(getChannelCredentials()).toBeNull();
    expect(createSsl).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({
      message:
        'CADENCE_GRPC_TLS_CERT_FILE and CADENCE_GRPC_TLS_KEY_FILE must be set together',
    });
  });

  it('should log an error when a TLS file cannot be read', () => {
    process.env.CADENCE_GRPC_TLS_CA_FILE = path.join(tmpDir, 'missing.pem');
    const { getChannelCredentials, createSsl, logger } = setup();

    expect(getChannelCredentials()).toBeNull();
    expect(createSsl).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to read GRPC TLS files' })
    );
  });

  it('should cache the credentials after the first call', () => {
    process.env.CADENCE_GRPC_TLS_CA_FILE = writeFile(tmpDir, 'ca.pem', 'ca');
    const { getChannelCredentials, createSsl } = setup();

    getChannelCredentials();
    getChannelCredentials();
    expect(createSsl).toHaveBeenCalledTimes(1);
  });
});

function writeFile(dir: string, name: string, content: string) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// Loads grpc-service in an isolated module registry, so that its credentials cache starts empty
function setup() {
  let grpcService!: typeof GrpcServiceModule;
  let grpc!: typeof GrpcJs;
  let logger!: { error: jest.Mock };
  jest.isolateModules(() => {
    grpc = require('@grpc/grpc-js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    logger = require('@/utils/logger').default;
    grpcService = require('../grpc-service');
  });

  const createSsl = jest
    .spyOn(grpc.credentials, 'createSsl')
    .mockReturnValue('ssl-credentials' as unknown as GrpcJs.ChannelCredentials);
  const createInsecure = jest
    .spyOn(grpc.credentials, 'createInsecure')
    .mockReturnValue(
      'insecure-credentials' as unknown as GrpcJs.ChannelCredentials
    );

  return {
    getChannelCredentials: grpcService.getChannelCredentials,
    createSsl,
    createInsecure,
    logger,
  };
}
