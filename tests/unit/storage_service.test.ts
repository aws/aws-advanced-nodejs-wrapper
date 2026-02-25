/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { StorageService } from "../../common/lib/utils/storage/storage_service";
import { Topology } from "../../common/lib/host_list_provider/topology";
import { CoreServicesContainer } from "../../common/lib/utils/core_services_container";
import { HostInfoBuilder } from "../../common/lib";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";

describe("test_storage_service", () => {
  let storageService: StorageService;

  beforeEach(() => {
    storageService = CoreServicesContainer.getInstance().getStorageService();
  });

  afterEach(() => {
    storageService.clearAll();
  });

  it("should correctly identify Topology class from constructor", () => {
    const topology = new Topology([]);
    const secondTopology = new Topology([
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("foo").build()
    ]);
    const key = "test-key";

    // Store the topology instance
    storageService.set(key, topology);

    let retrieved = storageService.get(Topology, key);
    expect(retrieved).toBeDefined();
    expect(retrieved).toBeInstanceOf(Topology);
    expect(retrieved).toBe(topology);

    storageService.set(key, secondTopology);

    // Ensure the topology cache has been overwritten.
    retrieved = storageService.get(Topology, key);
    expect(retrieved).toBeDefined();
    expect(retrieved).toBeInstanceOf(Topology);
    expect(retrieved).toBe(secondTopology);
  });
});
