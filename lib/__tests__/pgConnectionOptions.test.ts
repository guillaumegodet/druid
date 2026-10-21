import { describe, expect, it } from 'vitest';
import { pgConnectionOptions } from '../db/core';

describe('pgConnectionOptions (libpq meaning of sslmode)', () => {
  it('require: TLS without certificate verification, parameter removed', () => {
    expect(pgConnectionOptions('postgres://u:p@h:5432/d?sslmode=require'))
      .toEqual({ connectionString: 'postgres://u:p@h:5432/d', ssl: { rejectUnauthorized: false } });
  });
  it('keeps the other parameters, wherever sslmode sits', () => {
    expect(pgConnectionOptions('postgres://u:p@h/d?sslmode=require&search_path=t_x').connectionString).toBe('postgres://u:p@h/d?search_path=t_x');
    expect(pgConnectionOptions('postgres://u:p@h/d?search_path=t_x&sslmode=prefer').connectionString).toBe('postgres://u:p@h/d?search_path=t_x');
    expect(pgConnectionOptions('postgres://u:p@h/d?a=1&sslmode=require&b=2').connectionString).toBe('postgres://u:p@h/d?a=1&b=2');
  });
  it('disable: no TLS', () => {
    expect(pgConnectionOptions('postgres://u:p@h/d?sslmode=disable')).toEqual({ connectionString: 'postgres://u:p@h/d', ssl: false });
  });
  it('leaves the verifying modes, a root certificate and an explicit libpq compatibility to the driver', () => {
    for (const url of [
      'postgres://u:p@h/d?sslmode=verify-full',
      'postgres://u:p@h/d?sslmode=verify-ca&sslrootcert=/ca.pem',
      'postgres://u:p@h/d?sslmode=require&sslrootcert=/ca.pem',
      'postgres://u:p@h/d?uselibpqcompat=true&sslmode=require',
      'postgres://u:p@h/d',
    ]) expect(pgConnectionOptions(url)).toEqual({ connectionString: url });
  });
});
