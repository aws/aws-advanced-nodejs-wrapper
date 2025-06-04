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

import { ConfigurationProfile } from "./configuration_profile";
import { ConfigurationProfilePresetCodes } from "./configuration_profile_codes";
import { WrapperProperties } from "../wrapper_property";
import { HostMonitoringPluginFactory } from "../plugins/efm/host_monitoring_plugin_factory";
import { AuroraInitialConnectionStrategyFactory } from "../plugins/aurora_initial_connection_strategy_plugin_factory";
import {
  AuroraConnectionTrackerPluginFactory
} from "../plugins/connection_tracker/aurora_connection_tracker_plugin_factory";
import { ReadWriteSplittingPluginFactory } from "../plugins/read_write_splitting_plugin_factory";
import { FailoverPluginFactory } from "../plugins/failover/failover_plugin_factory";
import { InternalPooledConnectionProvider } from "../internal_pooled_connection_provider";
import { AwsPoolConfig } from "../aws_pool_config";
import { StaleDnsPluginFactory } from "../plugins/stale_dns/stale_dns_plugin_factory";

export class DriverConfigurationProfiles {
  private static readonly MONITORING_CONNECTION_PREFIX = "monitoring_";
  private static readonly activeProfiles: Map<string, ConfigurationProfile> = new Map<string, ConfigurationProfile>();
  private static readonly presets: Map<string, ConfigurationProfile> = new Map<string, ConfigurationProfile>([
    [
      ConfigurationProfilePresetCodes.A0,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.A0,
        [],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 5000],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.A1,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.A1,
        [],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 30000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 30000],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.A2,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.A2,
        [],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 3000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 3000],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.B,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.B,
        [],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: true }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.C0,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.C0,
        [HostMonitoringPluginFactory], // Factories should be presorted by weights!
        new Map<string, any>([
          [WrapperProperties.FAILURE_DETECTION_TIME_MS.name, 60000],
          [WrapperProperties.FAILURE_DETECTION_COUNT.name, 5],
          [WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name, 15000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 5000],
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.C1,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.C1,
        [HostMonitoringPluginFactory], // Factories should be presorted by weights!
        new Map<string, any>([
          [WrapperProperties.FAILURE_DETECTION_TIME_MS.name, 30000],
          [WrapperProperties.FAILURE_DETECTION_COUNT.name, 3],
          [WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name, 5000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 3000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 3000],
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.D0,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.D0,
        // Factories should be presorted by weights!
        [AuroraInitialConnectionStrategyFactory, AuroraConnectionTrackerPluginFactory, ReadWriteSplittingPluginFactory, FailoverPluginFactory],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 5000],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        () => {
          return new InternalPooledConnectionProvider(
            new AwsPoolConfig({
              maxConnections: 30,
              maxIdleConnections: 2,
              minConnections: 2,
              idleTimeoutMillis: 15 * 60000, // 15min
              allowExitOnIdle: true
            })
          );
        }
      )
    ],
    [
      ConfigurationProfilePresetCodes.D1,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.D1,
        // Factories should be presorted by weights!
        [AuroraInitialConnectionStrategyFactory, AuroraConnectionTrackerPluginFactory, ReadWriteSplittingPluginFactory, FailoverPluginFactory],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 30000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 30000],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        () => {
          return new InternalPooledConnectionProvider(
            new AwsPoolConfig({
              maxConnections: 30,
              maxIdleConnections: 2,
              minConnections: 2,
              idleTimeoutMillis: 15 * 60000, // 15min
              allowExitOnIdle: true
            })
          );
        }
      )
    ],
    [
      ConfigurationProfilePresetCodes.E,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.E,
        // Factories should be presorted by weights!
        [AuroraInitialConnectionStrategyFactory, AuroraConnectionTrackerPluginFactory, ReadWriteSplittingPluginFactory, FailoverPluginFactory],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: true }]
        ]),
        null,
        null,
        null,
        () => {
          return new InternalPooledConnectionProvider(
            new AwsPoolConfig({
              maxConnections: 30,
              maxIdleConnections: 2,
              minConnections: 2,
              idleTimeoutMillis: 15 * 60000, // 15min
              allowExitOnIdle: true
            })
          );
        }
      )
    ],
    [
      ConfigurationProfilePresetCodes.F0,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.F0,
        // Factories should be presorted by weights!
        [
          AuroraInitialConnectionStrategyFactory,
          AuroraConnectionTrackerPluginFactory,
          ReadWriteSplittingPluginFactory,
          FailoverPluginFactory,
          HostMonitoringPluginFactory
        ],
        new Map<string, any>([
          [WrapperProperties.FAILURE_DETECTION_TIME_MS.name, 60000],
          [WrapperProperties.FAILURE_DETECTION_COUNT.name, 5],
          [WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name, 15000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 5000],
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        () => {
          return new InternalPooledConnectionProvider(
            new AwsPoolConfig({
              maxConnections: 30,
              maxIdleConnections: 2,
              minConnections: 2,
              idleTimeoutMillis: 15 * 60000, // 15min
              allowExitOnIdle: true
            })
          );
        }
      )
    ],
    [
      ConfigurationProfilePresetCodes.F1,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.F1,
        // Factories should be presorted by weights!
        [
          AuroraInitialConnectionStrategyFactory,
          AuroraConnectionTrackerPluginFactory,
          ReadWriteSplittingPluginFactory,
          FailoverPluginFactory,
          HostMonitoringPluginFactory
        ],
        new Map<string, any>([
          [WrapperProperties.FAILURE_DETECTION_TIME_MS.name, 30000],
          [WrapperProperties.FAILURE_DETECTION_COUNT.name, 3],
          [WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name, 5000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 3000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 3000],
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        () => {
          return new InternalPooledConnectionProvider(
            new AwsPoolConfig({
              maxConnections: 30,
              maxIdleConnections: 2,
              minConnections: 2,
              idleTimeoutMillis: 15 * 60000, // 15min
              allowExitOnIdle: true
            })
          );
        }
      )
    ],
    [
      ConfigurationProfilePresetCodes.G0,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.G0,
        // Factories should be presorted by weights!
        [AuroraConnectionTrackerPluginFactory, StaleDnsPluginFactory, FailoverPluginFactory],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 5000],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.G1,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.G1,
        // Factories should be presorted by weights!
        [AuroraConnectionTrackerPluginFactory, StaleDnsPluginFactory, FailoverPluginFactory],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 30000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 30000],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.H,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.H,
        // Factories should be presorted by weights!
        [AuroraConnectionTrackerPluginFactory, StaleDnsPluginFactory, FailoverPluginFactory],
        new Map<string, any>([
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: true }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.I0,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.I0,
        // Factories should be presorted by weights!
        [AuroraConnectionTrackerPluginFactory, StaleDnsPluginFactory, FailoverPluginFactory, HostMonitoringPluginFactory],
        new Map<string, any>([
          [WrapperProperties.FAILURE_DETECTION_TIME_MS.name, 60000],
          [WrapperProperties.FAILURE_DETECTION_COUNT.name, 5],
          [WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name, 15000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 5000],
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: true }]
        ]),
        null,
        null,
        null,
        null
      )
    ],
    [
      ConfigurationProfilePresetCodes.I1,
      new ConfigurationProfile(
        ConfigurationProfilePresetCodes.I1,
        // Factories should be presorted by weights!
        [AuroraConnectionTrackerPluginFactory, StaleDnsPluginFactory, FailoverPluginFactory, HostMonitoringPluginFactory],
        new Map<string, any>([
          [WrapperProperties.FAILURE_DETECTION_TIME_MS.name, 30000],
          [WrapperProperties.FAILURE_DETECTION_COUNT.name, 3],
          [WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name, 5000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 3000],
          [DriverConfigurationProfiles.MONITORING_CONNECTION_PREFIX + WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 3000],
          [WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name, 10000],
          [WrapperProperties.WRAPPER_QUERY_TIMEOUT.name, 0],
          [WrapperProperties.KEEPALIVE_PROPERTIES.name, { keepAlive: false }]
        ]),
        null,
        null,
        null,
        null
      )
    ]
  ]);

  public static clear() {
    DriverConfigurationProfiles.clear();
  }

  public static addOrReplaceProfile(profileName: string, configurationProfile: ConfigurationProfile) {
    DriverConfigurationProfiles.activeProfiles.set(profileName, configurationProfile);
  }

  public static remove(profileName: string) {
    DriverConfigurationProfiles.activeProfiles.delete(profileName);
  }

  public static contains(profileName: string): boolean {
    return DriverConfigurationProfiles.activeProfiles.has(profileName);
  }

  public static getProfileConfiguration(profileName: string): ConfigurationProfile {
    const profile: ConfigurationProfile = DriverConfigurationProfiles.activeProfiles.get(profileName);
    if (profile) {
      return profile;
    }
    return DriverConfigurationProfiles.presets.get(profileName);
  }
}
