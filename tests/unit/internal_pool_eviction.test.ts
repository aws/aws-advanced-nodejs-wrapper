/*
  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
 
  http://www.apache.org/licenses/LICENSE-2.0
 
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { jest } from "@jest/globals";
import { PoolClientWrapper } from "../../common/lib/pool_client_wrapper";
import { AwsInternalPoolClient } from "../../common/lib/aws_pool_client";
import { InternalPooledConnectionProvider } from "../../common/lib/internal_pooled_connection_provider";
import { ConnectionProviderManager } from "../../common/lib/connection_provider_manager";
import { ConnectionProvider } from "../../common/lib/connection_provider";
import { DriverConnectionProvider } from "../../common/lib/driver_connection_provider";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { AwsPgInternalPoolClient } from "../../pg/lib/icp/pg_internal_pool_client";
import { AwsMysqlInternalPoolClient } from "../../mysql/lib/icp/mysql_internal_pool_client";

const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() })
  .withHost("database-test-name.XYZ.us-east-2.rds.amazonaws.com")
  .withPort(5432)
  .build();

function createPool(): AwsInternalPoolClient & { discardClient: jest.Mock<(client: any) => void> } {
  return {
    connect: jest.fn(),
    end: jest.fn(),
    releaseResources: jest.fn(),
    getIdleCount: jest.fn(),
    getTotalCount: jest.fn(),
    getActiveCount: jest.fn(),
    discardClient: jest.fn()
  } as any;
}

function createRawClient() {
  return { release: jest.fn() };
}

describe("internal pool eviction", () => {
  it("ending an unmarked client releases it to the pool", async () => {
    const pool = createPool();
    const raw = createRawClient();
    const client = new PoolClientWrapper(raw, hostInfo, new Map(), pool);

    await client.end();

    expect(raw.release).toHaveBeenCalledTimes(1);
    expect(pool.discardClient).not.toHaveBeenCalled();
  });

  it("ending a marked client discards it instead of releasing it", async () => {
    const pool = createPool();
    const raw = createRawClient();
    const client = new PoolClientWrapper(raw, hostInfo, new Map(), pool);

    expect(client.markForEviction()).toBe(true);
    await client.end();

    expect(pool.discardClient).toHaveBeenCalledWith(raw);
    expect(raw.release).not.toHaveBeenCalled();
  });

  it("a released client cannot be marked and is not released twice", async () => {
    const pool = createPool();
    const raw = createRawClient();
    const client = new PoolClientWrapper(raw, hostInfo, new Map(), pool);
    await client.end();

    // The pool may have handed the connection to another caller, so it must not be discarded now.
    expect(client.markForEviction()).toBe(false);
    await client.end();

    expect(raw.release).toHaveBeenCalledTimes(1);
    expect(pool.discardClient).not.toHaveBeenCalled();
  });

  it("a client without a pool cannot be marked", () => {
    const client = new PoolClientWrapper(createRawClient(), hostInfo, new Map());
    expect(client.markForEviction()).toBe(false);
  });

  it("pg pool discards a client by releasing it with a truthy argument", async () => {
    const pool = new AwsPgInternalPoolClient({});
    const raw = createRawClient();
    try {
      pool.discardClient(raw as any);
      expect(raw.release).toHaveBeenCalledWith(true);
    } finally {
      await pool.end();
    }
  });

  it("mysql2 pool discards a client by destroying it", async () => {
    const pool = new AwsMysqlInternalPoolClient({});
    const raw = { release: jest.fn(), destroy: jest.fn() };
    try {
      pool.discardClient(raw);
      expect(raw.destroy).toHaveBeenCalledTimes(1);
      expect(raw.release).not.toHaveBeenCalled();
    } finally {
      await pool.end();
    }
  });

  it("provider issues clients bound to their pool and evicts only its own clients", async () => {
    const provider = new InternalPooledConnectionProvider();
    const pool = createPool();
    const raw = createRawClient();
    pool.connect = jest.fn(() => Promise.resolve(raw));
    provider.internalPool = pool;

    const client = await provider.getPoolConnection(hostInfo, new Map());
    expect(provider.evictClient(client)).toBe(true);
    await client.end();
    expect(pool.discardClient).toHaveBeenCalledWith(raw);

    expect(provider.evictClient({ client: {} } as unknown as ClientWrapper)).toBe(false);
  });

  it("manager tries the effective provider, then the default provider once", () => {
    const client = {} as ClientWrapper;
    const effective = { evictClient: jest.fn(() => false) } as unknown as ConnectionProvider;
    const defaultProvider = { evictClient: jest.fn(() => true) } as unknown as ConnectionProvider;

    expect(new ConnectionProviderManager(defaultProvider, effective).evictClient(client)).toBe(true);
    expect(effective.evictClient).toHaveBeenCalledWith(client);
    expect(defaultProvider.evictClient).toHaveBeenCalledWith(client);

    // The same provider configured as both is asked only once.
    const shared = { evictClient: jest.fn(() => false) } as unknown as ConnectionProvider;
    expect(new ConnectionProviderManager(shared, shared).evictClient(client)).toBe(false);
    expect(shared.evictClient).toHaveBeenCalledTimes(1);
  });

  it("manager returns false when no provider supports eviction", () => {
    expect(new ConnectionProviderManager(new DriverConnectionProvider(), null).evictClient({} as ClientWrapper)).toBe(false);
  });
});
