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

import { RdsUrlType } from "./rds_url_type";

export class RdsUtils {
  // Aurora DB clusters support different endpoints. More details about Aurora RDS endpoints
  // can be found at
  // https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html
  //
  //   Details how to use RDS Proxy endpoints can be found at
  // https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-endpoints.html
  //
  //   Values like "<...>" depend on particular Aurora cluster.
  // For example: "<database-cluster-name>"
  //
  // Cluster (Writer) Endpoint: <database-cluster-name>.cluster-<xyz>.<aws-region>.rds.amazonaws.com
  // Example: test-postgres.cluster-123456789012.us-east-2.rds.amazonaws.com
  //
  // Cluster Reader Endpoint: <database-cluster-name>.cluster-ro-<xyz>.<aws-region>.rds.amazonaws.com
  // Example: test-postgres.cluster-ro-123456789012.us-east-2.rds.amazonaws.com
  //
  // Cluster Custom Endpoint: <cluster-name-alias>.cluster-custom-<xyz>.<aws-region>.rds.amazonaws.com
  // Example: test-postgres-alias.cluster-custom-123456789012.us-east-2.rds.amazonaws.com
  //
  // Instance Endpoint: <instance-name>.<xyz>.<aws-region>.rds.amazonaws.com
  // Example: test-postgres-instance-1.123456789012.us-east-2.rds.amazonaws.com
  //
  //
  // Similar endpoints for China regions have different structure and are presented below.
  //
  // Cluster (Writer) Endpoint: <database-cluster-name>.cluster-<xyz>.rds.<aws-region>.amazonaws.com.cn
  // Example: test-postgres.cluster-123456789012.rds.cn-northwest-1.amazonaws.com.cn
  //
  // Cluster Reader Endpoint: <database-cluster-name>.cluster-ro-<xyz>.rds.<aws-region>.amazonaws.com.cn
  // Example: test-postgres.cluster-ro-123456789012.rds.cn-northwest-1.amazonaws.com.cn
  //
  // Cluster Custom Endpoint: <cluster-name-alias>.cluster-custom-<xyz>.rds.<aws-region>.amazonaws.com.cn
  // Example: test-postgres-alias.cluster-custom-123456789012.rds.cn-northwest-1.amazonaws.com.cn
  //
  // Instance Endpoint: <instance-name>.<xyz>.rds.<aws-region>.amazonaws.com.cn
  // Example: test-postgres-instance-1.123456789012.rds.cn-northwest-1.amazonaws.com.cn

  private static readonly AURORA_DNS_PATTERN =
    /(?<instance>.+)\.(?<dns>proxy-|cluster-|cluster-ro-|cluster-custom-)?(?<domain>[a-zA-Z0-9]+\.(?<region>[a-zA-Z0-9-]+)\.rds\.amazonaws\.com)/i;
  private static readonly AURORA_INSTANCE_PATTERN = /(?<instance>.+)\.(?<domain>[a-zA-Z0-9]+\.(?<region>[a-zA-Z0-9-]+)\.rds\.amazonaws\.com)/i;
  private static readonly AURORA_CLUSTER_PATTERN =
    /(?<instance>.+)\.(?<dns>cluster-|cluster-ro-)+(?<domain>[a-zA-Z0-9]+\.(?<region>[a-zA-Z0-9-]+)\.rds\.amazonaws\.com)/i;
  private static readonly AURORA_CUSTOM_CLUSTER_PATTERN =
    /(?<instance>.+)\.(?<dns>cluster-custom-)+(?<domain>[a-zA-Z0-9]+\.(?<region>[a-zA-Z0-9-]+)\.rds\.amazonaws\.com)/i;
  private static readonly AURORA_PROXY_DNS_PATTERN =
    /(?<instance>.+)\.(?<dns>proxy-)+(?<domain>[a-zA-Z0-9]+\.(?<region>[a-zA-Z0-9-]+)\.rds\.amazonaws\.com)/i;
  private static readonly AURORA_CHINA_DNS_PATTERN =
    /(?<instance>.+)\.(?<dns>proxy-|cluster-|cluster-ro-|cluster-custom-)?(?<domain>[a-zA-Z0-9]+\.rds\.(?<region>[a-zA-Z0-9-]+)\.amazonaws\.com\.cn)/i;
  private static readonly AURORA_CHINA_INSTANCE_PATTERN =
    /(?<instance>.+)\.(?<domain>[a-zA-Z0-9]+\.(?<region>[a-zA-Z0-9-]+)\.rds\.amazonaws\.com\.cn)/i;
  private static readonly AURORA_CHINA_CLUSTER_PATTERN =
    /(?<instance>.+)\.(?<dns>cluster-|cluster-ro-)+(?<domain>[a-zA-Z0-9]+\.rds\.(?<region>[a-zA-Z0-9-]+)\.amazonaws\.com\.cn)/i;
  private static readonly AURORA_CHINA_CUSTOM_CLUSTER_PATTERN =
    /(?<instance>.+)\.(?<dns>cluster-custom-)+(?<domain>[a-zA-Z0-9]+\.rds\.(?<region>[a-zA-Z0-9-]+)\.amazonaws\.com\.cn)/i;
  private static readonly AURORA_CHINA_PROXY_DNS_PATTERN =
    /(?<instance>.+)\.(?<dns>proxy-)+(?<domain>[a-zA-Z0-9]+\.rds\.(?<region>[a-zA-Z0-9-])+\.amazonaws\.com\.cn)/i;
  private static readonly ELB_PATTERN = /(?<instance>.+)\.elb\.((?<region>[a-zA-Z0-9-]+)\.amazonaws\.com)/i;
  private static readonly IP_V4 =
    /^(([1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){1}(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){2}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/i;
  private static readonly IP_V6 = /^[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){7}$/i;
  private static readonly IP_V6_COMPRESSED = /^(([0-9A-Fa-f]{1,4}(:[0-9A-Fa-f]{1,4}){0,5})?)::(([0-9A-Fa-f]{1,4}(:[0-9A-Fa-f]{1,4}){0,5})?)$/i;
  private static readonly BG_GREEN_HOST_PATTERN = /.*(?<prefix>-green-[0-9a-z]{6})\..*/i;

  static readonly DNS_GROUP = "dns";
  static readonly INSTANCE_GROUP = "instance";
  static readonly DOMAIN_GROUP = "domain";
  static readonly REGION_GROUP = "region";

  public isRdsClusterDns(host: string): boolean | null {
    return host.match(RdsUtils.AURORA_CLUSTER_PATTERN) != null || host.match(RdsUtils.AURORA_CHINA_CLUSTER_PATTERN) != null;
  }

  public isRdsCustomClusterDns(host: string): boolean {
    return host.match(RdsUtils.AURORA_CUSTOM_CLUSTER_PATTERN) != null || host.match(RdsUtils.AURORA_CHINA_CUSTOM_CLUSTER_PATTERN) != null;
  }

  public isRdsDns(host: string) {
    return host.match(RdsUtils.AURORA_DNS_PATTERN) || host.match(RdsUtils.AURORA_CHINA_DNS_PATTERN);
  }

  public isRdsInstance(host: string) {
    return host.match(RdsUtils.AURORA_INSTANCE_PATTERN) || host.match(RdsUtils.AURORA_CHINA_INSTANCE_PATTERN);
  }

  isRdsProxyDns(host: string) {
    return host.match(RdsUtils.AURORA_PROXY_DNS_PATTERN) || host.match(RdsUtils.AURORA_CHINA_PROXY_DNS_PATTERN);
  }

  public isElbUrl(host: string) {
    return host.match(RdsUtils.ELB_PATTERN);
  }

  public getRdsInstanceId(host: string) {
    if (!host) {
      return null;
    }

    const instanceId = (host.match(RdsUtils.AURORA_INSTANCE_PATTERN) || host.match(RdsUtils.AURORA_CHINA_INSTANCE_PATTERN))?.groups?.[
      RdsUtils.INSTANCE_GROUP
    ];
    return instanceId ? instanceId : null;
  }

  public getRdsInstanceHostPattern(host: string): string {
    if (host == null) {
      return "?";
    }

    const matcher = host.match(RdsUtils.AURORA_DNS_PATTERN);
    if (matcher !== null && matcher.groups !== undefined) {
      return "?." + matcher.groups[RdsUtils.DOMAIN_GROUP];
    }
    const chinaMatcher = host.match(RdsUtils.AURORA_CHINA_DNS_PATTERN);
    if (chinaMatcher !== null && chinaMatcher.groups !== undefined) {
      return "?." + chinaMatcher.groups[RdsUtils.DOMAIN_GROUP];
    }
    return "?";
  }

  public getRdsRegion(host: string): string | null {
    const matcher = host.match(RdsUtils.AURORA_DNS_PATTERN);
    if (matcher !== null && matcher.groups !== undefined) {
      return matcher.groups[RdsUtils.REGION_GROUP];
    }
    const chinaMatcher = host.match(RdsUtils.AURORA_CHINA_DNS_PATTERN);
    if (chinaMatcher !== null && chinaMatcher.groups !== undefined) {
      return chinaMatcher.groups[RdsUtils.REGION_GROUP];
    }
    const elbMatcher = host.match(RdsUtils.ELB_PATTERN);
    if (elbMatcher !== null && elbMatcher.groups !== undefined) {
      return elbMatcher.groups[RdsUtils.REGION_GROUP];
    }
    return null;
  }

  public isWriterClusterDns(host: string) {
    if (host === undefined) {
      return false;
    }

    const matcher = host.match(RdsUtils.AURORA_CLUSTER_PATTERN);
    if (matcher !== null && matcher.groups !== undefined) {
      return "cluster-" === matcher.groups[RdsUtils.DNS_GROUP];
    }
    const chinaMatcher = host.match(RdsUtils.AURORA_CHINA_CLUSTER_PATTERN);
    if (chinaMatcher !== null && chinaMatcher.groups !== undefined) {
      return "cluster-" == chinaMatcher.groups[RdsUtils.DNS_GROUP];
    }
    return false;
  }

  public isReaderClusterDns(host: string): boolean {
    const matcher = host.match(RdsUtils.AURORA_CLUSTER_PATTERN);
    if (matcher !== null && matcher.groups !== undefined) {
      return "cluster-ro-" == matcher.groups[RdsUtils.DNS_GROUP];
    }
    const chinaMatcher = host.match(RdsUtils.AURORA_CHINA_CLUSTER_PATTERN);
    if (chinaMatcher !== null && chinaMatcher.groups !== undefined) {
      return "cluster-ro-" == chinaMatcher.groups[RdsUtils.DNS_GROUP];
    }
    return false;
  }

  public getRdsClusterHostUrl(host: string): string | null {
    const matcher = host.match(RdsUtils.AURORA_CLUSTER_PATTERN);
    if (matcher) {
      return host.replace(RdsUtils.AURORA_CLUSTER_PATTERN, "$<instance>.cluster-$<domain>");
    }
    const chinaMatcher = host.match(RdsUtils.AURORA_CHINA_CLUSTER_PATTERN);
    if (chinaMatcher) {
      return host.replace(RdsUtils.AURORA_CHINA_CLUSTER_PATTERN, "${<instance>.cluster-$<domain>");
    }
    return null;
  }

  public isIPv4(ip: string) {
    return ip.match(RdsUtils.IP_V4);
  }

  public isIPv6(ip: string) {
    return ip.match(RdsUtils.IP_V6) || ip.match(RdsUtils.IP_V6_COMPRESSED);
  }

  public isDnsPatternValid(pattern: string) {
    return pattern.includes("?");
  }

  public identifyRdsType(host: string): RdsUrlType {
    if (!host) {
      return RdsUrlType.OTHER;
    }

    if (this.isIPv4(host) || this.isIPv6(host)) {
      return RdsUrlType.IP_ADDRESS;
    } else if (this.isWriterClusterDns(host)) {
      return RdsUrlType.RDS_WRITER_CLUSTER;
    } else if (this.isReaderClusterDns(host)) {
      return RdsUrlType.RDS_READER_CLUSTER;
    } else if (this.isRdsCustomClusterDns(host)) {
      return RdsUrlType.RDS_CUSTOM_CLUSTER;
    } else if (this.isRdsProxyDns(host)) {
      return RdsUrlType.RDS_PROXY;
    } else if (this.isRdsDns(host)) {
      return RdsUrlType.RDS_INSTANCE;
    } else {
      // ELB URLs will also be classified as other
      return RdsUrlType.OTHER;
    }
  }

  public isGreenInstance(host: string) {
    return host && host.match(RdsUtils.BG_GREEN_HOST_PATTERN);
  }

  public removeGreenInstancePrefix(host: string): string {
    if (!host) {
      return host;
    }

    const matcher = host.match(RdsUtils.BG_GREEN_HOST_PATTERN);
    if (!matcher || matcher.length === 0) {
      return host;
    }

    const prefixGroup = matcher.groups?.prefix;
    if (!prefixGroup) {
      return host;
    }

    return host.replace(prefixGroup, "");
  }
}
