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

export class WrapperProperty<T> {
  name: string;
  description: string;
  defaultValue: any;

  constructor(name: string, description: string, defaultValue?: any) {
    this.name = name;
    this.description = description;
    this.defaultValue = defaultValue;
  }

  get(props: Map<string, any>): T {
    const val = props.get(this.name);
    if (val === undefined && this.defaultValue !== undefined) {
      return this.defaultValue;
    }

    return val;
  }

  set(props: Map<string, any>, val: T) {
    props.set(this.name, val);
  }
}

export class WrapperProperties {
  static readonly MONITORING_PROPERTY_PREFIX: string = "monitoring_";
  static readonly DEFAULT_PLUGINS = "auroraConnectionTracker,failover,efm";
  static readonly DEFAULT_TOKEN_EXPIRATION_SEC = 15 * 60;

  static readonly PLUGINS = new WrapperProperty<string>(
    "plugins",
    "Comma separated list of connection plugin codes",
    WrapperProperties.DEFAULT_PLUGINS
  );

  static readonly AUTO_SORT_PLUGIN_ORDER = new WrapperProperty<boolean>(
    "autoSortWrapperPluginOrder",
    "This flag is enabled by default, meaning that the plugins order will be automatically adjusted. Disable it at your own risk or if you really need plugins to be executed in a particular order.",
    true
  );

  static readonly USER = new WrapperProperty<string>("user", "Database user name", null);
  static readonly PASSWORD = new WrapperProperty<string>("password", "Database password", null);
  static readonly DATABASE = new WrapperProperty<string>("database", "Database name", null);
  static readonly PORT = new WrapperProperty<number>("port", "Database port", -1);
  static readonly HOST = new WrapperProperty<string>("host", "Database host", null);

  static readonly DIALECT = new WrapperProperty<string>("dialect", "A unique identifier for the supported database dialect.", "");

  static readonly INTERNAL_QUERY_TIMEOUT = new WrapperProperty<number>(
    "internal_query_timeout",
    "Timeout in milliseconds for the wrapper to execute internal queries, such as the query for cluster topology",
    20000
  );

  static readonly TRANSFER_SESSION_STATE_ON_SWITCH = new WrapperProperty<boolean>(
    "transferSessionStateOnSwitch",
    "Enables session state transfer to a new connection.",
    true
  );
  static readonly RESET_SESSION_STATE_ON_CLOSE = new WrapperProperty<boolean>(
    "resetSessionStateOnClose",
    "Enables resetting a connection's session state before closing it.",
    true
  );
  static readonly ROLLBACK_ON_SWITCH = new WrapperProperty<boolean>(
    "rollbackOnSwitch",
    "Enables to rollback a current transaction being in progress when switching to a new connection.",
    true
  );

  static readonly DEFAULT_HOST_AVAILABILITY_STRATEGY = new WrapperProperty<string>(
    "defaultHostAvailabilityStrategy",
    "An override for specifying the default host availability change strategy.",
    null
  );
  static readonly HOST_AVAILABILITY_STRATEGY_MAX_RETRIES = new WrapperProperty<number>(
    "hostAvailabilityStrategyMaxRetries",
    "Max number of retries for checking a host's availability.",
    5
  );
  static readonly HOST_AVAILABILITY_STRATEGY_INITIAL_BACKOFF_TIME_SEC = new WrapperProperty<number>(
    "hostAvailabilityStrategyInitialBackoffTimeSec",
    "The initial backoff time in seconds.",
    30
  );

  static readonly IAM_HOST = new WrapperProperty<string>("iamHost", "Overrides the host that is used to generate the IAM token", null);
  static readonly IAM_DEFAULT_PORT = new WrapperProperty<number>(
    "iamDefaultPort",
    "Overrides default port that is used to generate the IAM token",
    null
  );
  static readonly IAM_REGION = new WrapperProperty<string>("iamRegion", "Overrides AWS region that is used to generate the IAM token", null);
  static readonly IAM_ROLE_ARN = new WrapperProperty<string>("iamRoleArn", "The ARN of the IAM Role that is to be assumed.", null);
  static readonly IAM_IDP_ARN = new WrapperProperty<string>("iamIdpArn", "The ARN of the identity provider", null);
  static readonly IAM_TOKEN_EXPIRATION = new WrapperProperty<number>(
    "iamTokenExpiration",
    "IAM token cache expiration in seconds",
    this.DEFAULT_TOKEN_EXPIRATION_SEC
  );

  static readonly IDP_USERNAME = new WrapperProperty<string>("idpUsername", "The federated user name", null);
  static readonly IDP_PASSWORD = new WrapperProperty<string>("idpPassword", "The federated user password", null);
  static readonly IDP_ENDPOINT = new WrapperProperty<string>("idpEndpoint", "The hosting URL of the Identity Provider", null);
  static readonly IDP_PORT = new WrapperProperty<number>("idpPort", "The hosting port of the Identity Provider", 443);

  static readonly APP_ID = new WrapperProperty<string>("appId", "The ID of the AWS application configured on Okta", null);

  static readonly RELAYING_PARTY_ID = new WrapperProperty<string>("rpIdentifier", "The relaying party identifier", "urn:amazon:webservices");

  static readonly DB_USER = new WrapperProperty<string>("dbUser", "The IAM user used to access the database", null);

  static readonly HTTPS_AGENT_OPTIONS = new WrapperProperty<Record<string, any>>(
    "httpsAgentOptions",
    "The options to be passed into the httpsAgent",
    null
  );

  static readonly SECRET_ID = new WrapperProperty<string>("secretId", "The name or the ARN of the secret to retrieve.", null);
  static readonly SECRET_REGION = new WrapperProperty<string>("secretRegion", "The region of the secret to retrieve.", null);
  static readonly SECRET_ENDPOINT = new WrapperProperty<string>("secretEndpoint", "The endpoint of the secret to retrieve.", null);

  static readonly FAILOVER_CLUSTER_TOPOLOGY_REFRESH_RATE_MS = new WrapperProperty<number>(
    "failoverClusterTopologyRefreshRateMs",
    "Cluster topology refresh rate in millis during a writer failover process. " +
      "During the writer failover process, " +
      "cluster topology may be refreshed at a faster pace than normal to speed up " +
      "discovery of the newly promoted writer.",
    2000
  );
  static readonly FAILOVER_TIMEOUT_MS = new WrapperProperty<number>("failoverTimeoutMs", "Maximum allowed time for the failover process.", 300000);
  static readonly FAILOVER_WRITER_RECONNECT_INTERVAL_MS = new WrapperProperty<number>(
    "failoverWriterReconnectIntervalMs",
    "Interval of time to wait between attempts to reconnect to a failed writer during a writer failover process.",
    2000
  );
  static readonly FAILOVER_READER_CONNECT_TIMEOUT_MS = new WrapperProperty<number>(
    "failoverReaderConnectTimeoutMs",
    "Reader connection attempt timeout during a reader failover process.",
    30000
  );
  static readonly ENABLE_CLUSTER_AWARE_FAILOVER = new WrapperProperty<boolean>(
    "enableClusterAwareFailover",
    "Enable/disable cluster-aware failover logic.",
    true
  );
  static readonly FAILOVER_MODE = new WrapperProperty<string>("failoverMode", "Set host role to follow during failover.", "");

  static readonly CLUSTER_TOPOLOGY_REFRESH_RATE_MS = new WrapperProperty<number>(
    "clusterTopologyRefreshRateMs",
    "Cluster topology refresh rate in millis. " +
      "The cached topology for the cluster will be invalidated after the specified time, " +
      "after which it will be updated during the next interaction with the connection.",
    30000
  );

  static readonly CLUSTER_ID = new WrapperProperty<string>(
    "clusterId",
    "A unique identifier for the cluster. " +
      "Connections with the same cluster id share a cluster topology cache. " +
      "If unspecified, a cluster id is automatically created for AWS RDS clusters.",
    ""
  );

  static readonly CLUSTER_INSTANCE_HOST_PATTERN = new WrapperProperty<string>(
    "clusterInstanceHostPattern",
    "The cluster instance DNS pattern that will be used to build a complete instance endpoint. " +
      'A "?" character in this pattern should be used as a placeholder for cluster instance names. ' +
      "This pattern is required to be specified for IP address or custom domain connections to AWS RDS " +
      "clusters. Otherwise, if unspecified, the pattern will be automatically created for AWS RDS clusters."
  );

  static readonly SINGLE_WRITER_CONNECTION_STRING = new WrapperProperty<boolean>(
    "singleWriterConnectionString",
    "Set to true if you are providing a connection string with multiple comma-delimited hosts and your cluster has only one writer. The writer must be the first host in the connection string",
    "false"
  );

  static readonly ENABLE_GREEN_HOST_REPLACEMENT = new WrapperProperty<boolean>(
    "enableGreenHostReplacement",
    "Enables replacing a green host name with the original hostname after a blue/green switchover and the green name no longer resolves.",
    "false"
  );

  static readonly READER_HOST_SELECTOR_STRATEGY = new WrapperProperty<string>(
    "readerHostSelectorStrategy",
    "The strategy that should be used to select a new reader host.",
    "random"
  );
  static readonly OPEN_CONNECTION_RETRY_TIMEOUT_MS = new WrapperProperty<number>(
    "openConnectionRetryTimeoutMs",
    "Maximum allowed time for the retries opening a connection.",
    30000
  );
  static readonly OPEN_CONNECTION_RETRY_INTERVAL_MS = new WrapperProperty<number>(
    "openConnectionRetryIntervalMs",
    "Time between each retry of opening a connection.",
    1000
  );

  static readonly FAILURE_DETECTION_TIME_MS = new WrapperProperty<number>(
    "failureDetectionTime",
    "Interval in millis between sending SQL to the server and the first probe to database host.",
    30000
  );

  static readonly FAILURE_DETECTION_ENABLED = new WrapperProperty<boolean>(
    "failureDetectionEnabled",
    "Enable enhanced failure detection logic.",
    true
  );

  static readonly FAILURE_DETECTION_INTERVAL_MS = new WrapperProperty<number>(
    "failureDetectionInterval",
    "Interval in millis between probes to database host.",
    5000
  );

  static readonly FAILURE_DETECTION_COUNT = new WrapperProperty<number>(
    "failureDetectionCount",
    "Number of failed connection checks before considering database host unhealthy.",
    3
  );

  static readonly MONITOR_DISPOSAL_TIME_MS = new WrapperProperty<number>(
    "monitorDisposalTime",
    "Interval in milliseconds for a monitor to be considered inactive and to be disposed.",
    600000 // 10 minutes
  );

  static readonly ROUND_ROBIN_HOST_WEIGHT_PAIRS = new WrapperProperty<string>(
    "roundRobinHostWeightPairs",
    "Comma separated list of database host-weight pairs in the format of `<host>:<weight>`.",
    null
  );

  static readonly ROUND_ROBIN_DEFAULT_WEIGHT = new WrapperProperty<number>(
    "roundRobinDefaultWeight",
    "The default weight for any hosts that have not been configured with the `roundRobinHostWeightPairs` parameter.",
    1
  );

  static readonly ENABLE_TELEMETRY = new WrapperProperty<boolean>("enableTelemetry", "Enables telemetry and observability of the wrapper", false);

  static readonly TELEMETRY_SUBMIT_TOPLEVEL = new WrapperProperty<boolean>(
    "telemetrySubmitToplevel",
    "Force submitting traces related to calls as top level traces.",
    false
  );

  static readonly TELEMETRY_TRACES_BACKEND = new WrapperProperty<string>(
    "telemetryTracesBackend",
    "Method to export telemetry traces of the wrapper.",
    null
  );

  static readonly TELEMETRY_METRICS_BACKEND = new WrapperProperty<string>(
    "telemetryMetricsBackend",
    "Method to export telemetry metrics of the wrapper.",
    null
  );

  static readonly TELEMETRY_FAILOVER_ADDITIONAL_TOP_TRACE = new WrapperProperty<boolean>(
    "telemetryFailoverAdditionalTopTrace",
    "Post an additional top-level trace for failover process.",
    false
  );

  static removeWrapperProperties(props: Map<string, any>): any {
    const persistingProperties = [
      WrapperProperties.USER.name,
      WrapperProperties.PASSWORD.name,
      WrapperProperties.DATABASE.name,
      WrapperProperties.PORT.name,
      WrapperProperties.HOST.name
    ];

    const copy = new Map(props);

    for (const key of props.keys()) {
      if (!key.startsWith(WrapperProperties.MONITORING_PROPERTY_PREFIX)) {
        continue;
      }

      copy.delete(key);
    }

    Object.values(WrapperProperties).forEach((prop) => {
      if (prop instanceof WrapperProperty) {
        const propertyName = (prop as WrapperProperty<any>).name;
        if (!persistingProperties.includes(propertyName) && copy.has(propertyName)) {
          copy.delete(propertyName);
        }
      }
    });

    return Object.fromEntries(copy.entries());
  }
}
