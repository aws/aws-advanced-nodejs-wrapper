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

import { isBlueGreenDialect } from "../../common/lib/database_dialect/blue_green_dialect";
import { BlueGreenStatusProvider } from "../../common/lib/plugins/bluegreen/blue_green_status_provider";
import { FullServicesContainer } from "../../common/lib/utils/full_services_container";

const unsupportedDialect = { getDialectName: () => "UnsupportedDialect" };
const blueGreenDialect = {
  getDialectName: () => "BlueGreenDialect",
  isBlueGreenStatusAvailable: async () => true,
  getBlueGreenStatus: async () => []
};

class RecordingStatusProvider extends BlueGreenStatusProvider {
  static monitoringStarted = false;

  protected initMonitoring(): void {
    RecordingStatusProvider.monitoringStarted = true;
  }
}

function containerWith(dialect: any): FullServicesContainer {
  return { pluginService: { getDialect: () => dialect }, storageService: {} } as unknown as FullServicesContainer;
}

describe("blue/green dialect check", () => {
  beforeEach(() => {
    RecordingStatusProvider.monitoringStarted = false;
  });

  it("rejects a dialect without the Blue/Green status methods", () => {
    expect(isBlueGreenDialect(unsupportedDialect)).toBe(false);
    expect(isBlueGreenDialect(null)).toBe(false);
  });

  it("accepts a dialect with both Blue/Green status methods", () => {
    expect(isBlueGreenDialect(blueGreenDialect)).toBe(true);
  });

  it("does not start monitoring on an unsupported dialect", () => {
    expect(() => new RecordingStatusProvider(containerWith(unsupportedDialect), new Map(), "bgd")).not.toThrow();
    expect(RecordingStatusProvider.monitoringStarted).toBe(false);
  });

  it("starts monitoring on a Blue/Green dialect", () => {
    new RecordingStatusProvider(containerWith(blueGreenDialect), new Map(), "bgd");
    expect(RecordingStatusProvider.monitoringStarted).toBe(true);
  });
});
