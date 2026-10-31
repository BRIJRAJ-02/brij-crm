// An API key's shape (parity #34): it names its workspace and key, and nothing but a key of exactly that shape parses.
import { describe, expect, it } from 'vitest';
import { fieldLevel, keyAccess, objectLevel, roleAccess, type Access } from '../access/policy.ts';
import {
  KEY_PREFIX,
  keyHint,
  keySecretHash,
  keySecretMatches,
  keyToken,
  newKeySecret,
  parseKeyToken,
} from './tokens.ts';

const WORKSPACE = '0192f1a2-3b4c-7d5e-8f60-718293a4b5c6';
const KEY = '0192f1a2-3b4c-7d5e-8f60-000000000001';

describe('API key tokens', () => {
  it('round trips the workspace, the key and the secret', () => {
    const secret = newKeySecret();
    const token = keyToken({ workspaceId: WORKSPACE, keyId: KEY, secret });
    expect(token.startsWith(KEY_PREFIX)).toBe(true);
    expect(token).toHaveLength(KEY_PREFIX.length + 87);
    expect(parseKeyToken(token)).toEqual({ workspaceId: WORKSPACE, keyId: KEY, secret });
  });

  it('parses nothing that is not a key', () => {
    const token = keyToken({ workspaceId: WORKSPACE, keyId: KEY, secret: newKeySecret() });
    for (const bad of [
      '',
      'crm_',
      token.slice(1),
      `${token}x`,
      token.replace(KEY_PREFIX, 'sk_'),
      `${token.slice(0, KEY_PREFIX.length + 43)}-${token.slice(KEY_PREFIX.length + 44)}`,
      `${token.slice(0, -1)}=`,
    ]) {
      expect(parseKeyToken(bad)).toBeUndefined();
    }
  });

  it('stores only a hash, and matches only the same secret', () => {
    const secret = newKeySecret();
    const stored = keySecretHash(secret);
    expect(stored).toHaveLength(32);
    expect(stored.toString('base64url')).not.toContain(secret);
    expect(keySecretMatches(secret, stored)).toBe(true);
    expect(keySecretMatches(newKeySecret(), stored)).toBe(false);
    expect(keySecretMatches(secret, Buffer.alloc(31))).toBe(false);
    expect(keyHint(secret)).toBe(secret.slice(-4));
  });
});

describe('a key is never wider than its creator', () => {
  const OPEN_OBJECT = '0192f1a2-3b4c-7d5e-8f60-0000000000a1';
  const READ_OBJECT = '0192f1a2-3b4c-7d5e-8f60-0000000000a2';
  const RULED_OBJECT = '0192f1a2-3b4c-7d5e-8f60-0000000000a3';
  const HIDDEN_FIELD = '0192f1a2-3b4c-7d5e-8f60-0000000000f1';
  const creator: Access = roleAccess(
    { kind: 'member', memberId: '0192f1a2-3b4c-7d5e-8f60-0000000000c1', role: 'member', teamIds: [] },
    {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: READ_OBJECT }, level: 'read' },
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: OPEN_OBJECT, attributeId: HIDDEN_FIELD },
          level: 'hidden',
        },
      ],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: RULED_OBJECT,
          kind: 'own',
          attributeId: '0192f1a2-3b4c-7d5e-8f60-0000000000f2',
        },
      ],
    },
  );

  it('takes the lower level of the key and the creator, closes record rule objects and keeps hidden fields hidden', () => {
    const access = keyAccess(KEY, ['data.read', 'data.write'], creator);
    expect(access.principal).toMatchObject({ kind: 'api_key', keyId: KEY });
    expect(objectLevel(access, OPEN_OBJECT)).toBe('write');
    expect(objectLevel(access, READ_OBJECT)).toBe('read');
    expect(objectLevel(access, RULED_OBJECT)).toBe('none');
    expect(fieldLevel(access, { id: HIDDEN_FIELD, objectId: OPEN_OBJECT })).toBe('hidden');
    expect(access.data.records).toEqual({});
  });

  it('a read key reads where the creator writes, and never writes', () => {
    const access = keyAccess(KEY, ['data.read'], creator);
    expect(objectLevel(access, OPEN_OBJECT)).toBe('read');
    expect(objectLevel(access, READ_OBJECT)).toBe('read');
  });

  it('holds no permission its creator lacks', () => {
    expect(keyAccess(KEY, ['data.read', 'records.export', 'schema.manage'], creator).permissions).toEqual(
      creator.permissions.filter((permission) => permission === 'records.export'),
    );
  });
});
