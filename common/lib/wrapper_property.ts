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
  static readonly DEFAULT_PLUGINS = "auroraConnectionTracker,failover,hostMonitoring";
  static readonly DEFAULT_TOKEN_EXPIRATION_SEC = 15 * 60;

  static readonly PLUGINS = new WrapperProperty<string>(
    "plugins",
    "Comma separated list of connection plugin codes",
    WrapperProperties.DEFAULT_PLUGINS
  );
  static readonly USER = new WrapperProperty<string>("user", "Database user name", null);
  static readonly PASSWORD = new WrapperProperty<string>("password", "Database password", null);
  static readonly DATABASE = new WrapperProperty<string>("database", "Database name", null);
  static readonly PORT = new WrapperProperty<number>("port", "Database port", -1);

  static readonly IAM_HOST = new WrapperProperty<string>("iamHost", "Overrides the host that is used to generate the IAM token", null);
  static readonly IAM_DEFAULT_PORT = new WrapperProperty<number>(
    "iamDefaultPort",
    "Overrides default port that is used to generate the IAM token",
    null
  );
  static readonly IAM_REGION = new WrapperProperty<string>("iamRegion", "Overrides AWS region that is used to generate the IAM token", null);
  static readonly IAM_EXPIRATION = new WrapperProperty<number>(
    "iamExpiration",
    "IAM token cache expiration in seconds",
    WrapperProperties.DEFAULT_TOKEN_EXPIRATION_SEC
  );

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

  static removeWrapperProperties<T>(config: T): T {
    const copy = Object.assign({}, config);
    const persistingProperties = [
      WrapperProperties.USER.name,
      WrapperProperties.PASSWORD.name,
      WrapperProperties.DATABASE.name,
      WrapperProperties.PORT.name
    ];

    Object.values(WrapperProperties).forEach((prop) => {
      if (prop instanceof WrapperProperty) {
        const propertyName = (prop as WrapperProperty<any>).name;
        if (!persistingProperties.includes(propertyName) && Object.hasOwn(config as object, propertyName)) {
          // @ts-expect-error
          delete copy[propertyName];
        }
      }
    });

    return copy;
  }
}
