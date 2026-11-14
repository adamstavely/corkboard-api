import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { IssueHttp } from '../integrations/issue-http';
import { ipv6Bytes, isPrivateAddress } from './addresses';
import { unfurl } from './unfurl';

describe('which addresses the server may reach', () => {
  it('refuses every way of writing a private or special address', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '198.18.0.1',
      '192.0.2.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fd00::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
      '2001:db8::1',
      '2001::1',
      '100::1',
      // IPv4 inside IPv6: mapped (dotted and hex, as URL writes it), compatible, NAT64 and 6to4.
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '[::ffff:7f00:1]',
      '::127.0.0.1',
      '::7f00:1',
      '64:ff9b::7f00:1',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:1::',
      '2002:c0a8:101::1',
      'not an address',
    ]) {
      expect([a, isPrivateAddress(a)]).toEqual([a, true]);
    }
  });

  it('lets public addresses through, in any form', () => {
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1', '2a00:1450:4009:81e::200e']) {
      expect([a, isPrivateAddress(a)]).toEqual([a, false]);
    }
  });

  it('reads IPv6 addresses as bytes', () => {
    expect(ipv6Bytes('::ffff:127.0.0.1')).toEqual(ipv6Bytes('::ffff:7f00:1'));
    expect(ipv6Bytes('::1')).toEqual([...Array<number>(15).fill(0), 1]);
    expect(ipv6Bytes('1.2.3.4')).toBeNull();
  });

  describe('with a server on this machine', () => {
    let server: http.Server;
    let port = 0;
    beforeAll(async () => {
      server = http.createServer((_req, res) => res.end('<title>Private</title>')).listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise((r) => server.close(r)));

    it('never fetches it through a mapped IPv6 address', async () => {
      await expect(unfurl(`http://[::ffff:127.0.0.1]:${port}/private`)).rejects.toThrow('not allowed');
      await expect(unfurl(`http://[::ffff:7f00:1]:${port}/private`)).rejects.toThrow('not allowed');
    });

    it('never sends an issue tracker request to an address written in the URL', async () => {
      await expect(new IssueHttp().request(`https://127.0.0.1:${port}/rest`, { method: 'GET', headers: {} })).rejects.toThrow('not allowed');
      await expect(new IssueHttp().request(`https://[::ffff:7f00:1]:${port}/rest`, { method: 'GET', headers: {} })).rejects.toThrow('not allowed');
    });
  });
});
