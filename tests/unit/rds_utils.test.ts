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

import { RdsUtils } from "../../common/lib/utils/rds_utils";

const us_east_region_cluster = "database-test-name.cluster-XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_cluster_read_only = "database-test-name.cluster-ro-XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_instance = "instance-test-name.XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_proxy = "proxy-test-name.proxy-XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_custom_domain = "custom-test-name.cluster-custom-XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_limitless_db_shard_group = "database-test-name.shardgrp-XYZ.us-east-2.rds.amazonaws.com";
const usEastRegionElbUrl = "elb-name.elb.us-east-2.amazonaws.com";

const china_region_cluster = "database-test-name.cluster-XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const old_china_region_cluster = "database-test-name.cluster-XYZ.cn-northwest-1.rds.amazonaws.com.cn";
const china_region_cluster_read_only = "database-test-name.cluster-ro-XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const old_china_region_cluster_read_only = "database-test-name.cluster-ro-XYZ.cn-northwest-1.rds.amazonaws.com.cn";
const china_region_instance = "instance-test-name.XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const old_china_region_instance = "instance-test-name.XYZ.cn-northwest-1.rds.amazonaws.com.cn";
const china_region_proxy = "proxy-test-name.proxy-XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const old_china_region_proxy = "proxy-test-name.proxy-XYZ.cn-northwest-1.rds.amazonaws.com.cn";
const china_region_custom_domain = "custom-test-name.cluster-custom-XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const old_china_region_custom_domain = "custom-test-name.cluster-custom-XYZ.cn-northwest-1.rds.amazonaws.com.cn";
const china_region_limitless_db_shard_group = "database-test-name.shardgrp-XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const old_china_region_limitless_db_shard_group = "database-test-name.shardgrp-XYZ.cn-northwest-1.rds.amazonaws.com.cn";

const usIsobEastRegionCluster = "database-test-name.cluster-XYZ.rds.us-isob-east-1.sc2s.sgov.gov";
const usIsobEastRegionClusterReadOnly = "database-test-name.cluster-ro-XYZ.rds.us-isob-east-1.sc2s.sgov.gov";
const usIsobEastRegionInstance = "instance-test-name.XYZ.rds.us-isob-east-1.sc2s.sgov.gov";
const usIsobEastRegionProxy = "proxy-test-name.proxy-XYZ.rds.us-isob-east-1.sc2s.sgov.gov";
const usIsobEastRegionCustomDomain = "custom-test-name.cluster-custom-XYZ.rds.us-isob-east-1.sc2s.sgov.gov";

const usGovEastRegionCluster = "database-test-name.cluster-XYZ.rds.us-gov-east-1.amazonaws.com";
const usIsoEastRegionCluster = "database-test-name.cluster-XYZ.rds.us-iso-east-1.c2s.ic.gov";
const usIsoEastRegionClusterReadOnly = "database-test-name.cluster-ro-XYZ.rds.us-iso-east-1.c2s.ic.gov";
const usIsoEastRegionInstance = "instance-test-name.XYZ.rds.us-iso-east-1.c2s.ic.gov";
const usIsoEastRegionProxy = "proxy-test-name.proxy-XYZ.rds.us-iso-east-1.c2s.ic.gov";
const usIsoEastRegionCustomDomain = "custom-test-name.cluster-custom-XYZ.rds.us-iso-east-1.c2s.ic.gov";

const extraRdsChinaPath = "database-test-name.cluster-XYZ.rds.cn-northwest-1.rds.amazonaws.com.cn";
const missingCnChinaPath = "database-test-name.cluster-XYZ.rds.cn-northwest-1.amazonaws.com";
const missingRegionChinaPath = "database-test-name.cluster-XYZ.rds.amazonaws.com.cn";

describe("test_rds_utils", () => {
  beforeEach(() => {
    RdsUtils.clearCache();
  });

  it.each([
    [us_east_region_cluster],
    [us_east_region_cluster_read_only],
    [china_region_cluster],
    [china_region_cluster_read_only],
    [old_china_region_cluster],
    [old_china_region_cluster_read_only],
    [usIsobEastRegionCluster],
    [usIsobEastRegionClusterReadOnly],
    [usIsoEastRegionCluster],
    [usIsoEastRegionClusterReadOnly]
  ])("test_is_rds_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isRdsClusterDns(val)).toBeTruthy();
  });

  it.each([
    [us_east_region_instance],
    [us_east_region_proxy],
    [us_east_region_custom_domain],
    [usEastRegionElbUrl],
    [china_region_instance],
    [china_region_proxy],
    [china_region_custom_domain],
    [old_china_region_instance],
    [old_china_region_proxy],
    [old_china_region_custom_domain],
    [usIsobEastRegionInstance],
    [usIsobEastRegionProxy],
    [usIsobEastRegionCustomDomain],
    [usIsoEastRegionInstance],
    [usIsoEastRegionProxy],
    [usIsoEastRegionCustomDomain]
  ])("test_is_not_rds_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isRdsClusterDns(val)).toBeFalsy();
  });

  it.each([
    [us_east_region_cluster],
    [us_east_region_cluster_read_only],
    [us_east_region_instance],
    [us_east_region_proxy],
    [us_east_region_custom_domain],
    [us_east_region_limitless_db_shard_group],
    [china_region_cluster],
    [china_region_cluster_read_only],
    [china_region_instance],
    [china_region_proxy],
    [china_region_custom_domain],
    [china_region_limitless_db_shard_group],
    [old_china_region_cluster],
    [old_china_region_cluster_read_only],
    [old_china_region_instance],
    [old_china_region_proxy],
    [old_china_region_custom_domain],
    [old_china_region_limitless_db_shard_group],
    [usIsobEastRegionCluster],
    [usIsobEastRegionClusterReadOnly],
    [usIsobEastRegionInstance],
    [usIsobEastRegionProxy],
    [usIsobEastRegionCustomDomain],
    [usIsoEastRegionCluster],
    [usIsoEastRegionClusterReadOnly],
    [usIsoEastRegionInstance],
    [usIsoEastRegionProxy],
    [usIsoEastRegionCustomDomain]
  ])("test_is_rds_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isRdsDns(val)).toBeTruthy();
  });

  it.each([[usEastRegionElbUrl]])("test_is_not_rds_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isRdsDns(val)).toBeFalsy();
  });

  it.each([
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_cluster],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_cluster_read_only],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_instance],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_proxy],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_custom_domain],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_limitless_db_shard_group],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_cluster],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_cluster_read_only],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_instance],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_proxy],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_custom_domain],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_limitless_db_shard_group],
    ["?.XYZ.cn-northwest-1.rds.amazonaws.com.cn", old_china_region_cluster],
    ["?.XYZ.cn-northwest-1.rds.amazonaws.com.cn", old_china_region_cluster_read_only],
    ["?.XYZ.cn-northwest-1.rds.amazonaws.com.cn", old_china_region_instance],
    ["?.XYZ.cn-northwest-1.rds.amazonaws.com.cn", old_china_region_proxy],
    ["?.XYZ.cn-northwest-1.rds.amazonaws.com.cn", old_china_region_custom_domain],
    ["?.XYZ.cn-northwest-1.rds.amazonaws.com.cn", old_china_region_limitless_db_shard_group],
    ["?.XYZ.rds.us-gov-east-1.amazonaws.com", usGovEastRegionCluster],
    ["?.XYZ.rds.us-isob-east-1.sc2s.sgov.gov", usIsobEastRegionCluster],
    ["?.XYZ.rds.us-isob-east-1.sc2s.sgov.gov", usIsobEastRegionClusterReadOnly],
    ["?.XYZ.rds.us-isob-east-1.sc2s.sgov.gov", usIsobEastRegionInstance],
    ["?.XYZ.rds.us-isob-east-1.sc2s.sgov.gov", usIsobEastRegionProxy],
    ["?.XYZ.rds.us-isob-east-1.sc2s.sgov.gov", usIsobEastRegionCustomDomain],
    ["?.XYZ.rds.us-iso-east-1.c2s.ic.gov", usIsoEastRegionCluster],
    ["?.XYZ.rds.us-iso-east-1.c2s.ic.gov", usIsoEastRegionClusterReadOnly],
    ["?.XYZ.rds.us-iso-east-1.c2s.ic.gov", usIsoEastRegionInstance],
    ["?.XYZ.rds.us-iso-east-1.c2s.ic.gov", usIsoEastRegionProxy],
    ["?.XYZ.rds.us-iso-east-1.c2s.ic.gov", usIsoEastRegionCustomDomain]
  ])("test_get_rds_instance_host_pattern", (expected: string, val) => {
    const target = new RdsUtils();
    expect(target.getRdsInstanceHostPattern(val)).toEqual(expected);
  });

  it.each([
    ["us-east-2", us_east_region_cluster],
    ["us-east-2", us_east_region_cluster_read_only],
    ["us-east-2", us_east_region_instance],
    ["us-east-2", us_east_region_proxy],
    ["us-east-2", us_east_region_custom_domain],
    ["cn-northwest-1", china_region_cluster],
    ["cn-northwest-1", china_region_cluster_read_only],
    ["cn-northwest-1", china_region_instance],
    ["cn-northwest-1", china_region_proxy],
    ["cn-northwest-1", china_region_custom_domain],
    ["cn-northwest-1", old_china_region_cluster],
    ["cn-northwest-1", old_china_region_cluster_read_only],
    ["cn-northwest-1", old_china_region_instance],
    ["cn-northwest-1", old_china_region_proxy],
    ["cn-northwest-1", old_china_region_custom_domain],
    ["us-gov-east-1", usGovEastRegionCluster],
    ["us-isob-east-1", usIsobEastRegionCluster],
    ["us-isob-east-1", usIsobEastRegionClusterReadOnly],
    ["us-isob-east-1", usIsobEastRegionInstance],
    ["us-isob-east-1", usIsobEastRegionProxy],
    ["us-isob-east-1", usIsobEastRegionCustomDomain],
    ["us-iso-east-1", usIsoEastRegionCluster],
    ["us-iso-east-1", usIsoEastRegionClusterReadOnly],
    ["us-iso-east-1", usIsoEastRegionInstance],
    ["us-iso-east-1", usIsoEastRegionProxy],
    ["us-iso-east-1", usIsoEastRegionCustomDomain]
  ])("test_get_rds_region", (expected: string, val) => {
    const target = new RdsUtils();
    expect(target.getRdsRegion(val)).toEqual(expected);
  });

  it.each([[us_east_region_cluster], [china_region_cluster], [old_china_region_cluster], [usIsobEastRegionCluster], [usIsoEastRegionCluster]])(
    "test_is_writer_cluster_dns",
    (val) => {
      const target = new RdsUtils();
      expect(target.isWriterClusterDns(val)).toBeTruthy();
    }
  );

  it.each([
    [us_east_region_cluster_read_only],
    [us_east_region_instance],
    [us_east_region_proxy],
    [us_east_region_custom_domain],
    [us_east_region_limitless_db_shard_group],
    [china_region_cluster_read_only],
    [china_region_instance],
    [china_region_proxy],
    [china_region_custom_domain],
    [china_region_limitless_db_shard_group],
    [old_china_region_cluster_read_only],
    [old_china_region_instance],
    [old_china_region_proxy],
    [old_china_region_custom_domain],
    [old_china_region_limitless_db_shard_group],
    [usIsobEastRegionClusterReadOnly],
    [usIsobEastRegionInstance],
    [usIsobEastRegionProxy],
    [usIsobEastRegionCustomDomain],
    [usIsoEastRegionClusterReadOnly],
    [usIsoEastRegionInstance],
    [usIsoEastRegionProxy],
    [usIsoEastRegionCustomDomain]
  ])("test_is_not_writer_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isWriterClusterDns(val)).toBeFalsy();
  });

  it.each([
    [us_east_region_cluster_read_only],
    [china_region_cluster_read_only],
    [old_china_region_cluster_read_only],
    [usIsobEastRegionClusterReadOnly],
    [usIsoEastRegionClusterReadOnly]
  ])("test_is_reader_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isReaderClusterDns(val)).toBeTruthy();
  });

  it.each([
    [us_east_region_cluster],
    [us_east_region_instance],
    [us_east_region_proxy],
    [us_east_region_custom_domain],
    [us_east_region_limitless_db_shard_group],
    [china_region_cluster],
    [china_region_instance],
    [china_region_proxy],
    [china_region_custom_domain],
    [china_region_limitless_db_shard_group],
    [old_china_region_cluster],
    [old_china_region_instance],
    [old_china_region_proxy],
    [old_china_region_custom_domain],
    [old_china_region_limitless_db_shard_group],
    [usIsobEastRegionCluster],
    [usIsobEastRegionInstance],
    [usIsobEastRegionProxy],
    [usIsobEastRegionCustomDomain],
    [usIsoEastRegionCluster],
    [usIsoEastRegionInstance],
    [usIsoEastRegionProxy],
    [usIsoEastRegionCustomDomain]
  ])("test_is_not_reader_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isReaderClusterDns(val)).toBeFalsy();
  });

  it.each([[us_east_region_limitless_db_shard_group], [china_region_limitless_db_shard_group], [old_china_region_limitless_db_shard_group]])(
    "test_is_limitless_dns",
    (val) => {
      const target = new RdsUtils();
      expect(target.isLimitlessDbShardGroupDns(val)).toBeTruthy();
    }
  );

  it("test_get_rds_cluster_host_url", () => {
    const expected: string = "foo.cluster-xyz.us-west-1.rds.amazonaws.com";
    const expected2: string = "foo-2.cluster-xyz.rds.us-west-1.amazonaws.com.cn";
    const expected3: string = "foo-3.cluster-xyz.us-west-1.rds.amazonaws.com.cn";
    const ro_endpoint: string = "foo.cluster-ro-xyz.us-west-1.rds.amazonaws.com";
    const china_ro_endpoint: string = "foo-2.cluster-ro-xyz.rds.us-west-1.amazonaws.com.cn";
    const old_china_ro_endpoint: string = "foo-3.cluster-ro-xyz.us-west-1.rds.amazonaws.com.cn";

    const target = new RdsUtils();
    expect(target.getRdsClusterHostUrl(ro_endpoint)).toEqual(expected);
    expect(target.getRdsClusterHostUrl(china_ro_endpoint)).toEqual(expected2);
    expect(target.getRdsClusterHostUrl(old_china_ro_endpoint)).toEqual(expected3);
  });

  it("test_green_instance_host_name", () => {
    const target = new RdsUtils();
    expect(target.isGreenInstance("test-instance")).toBeFalsy();
    expect(target.isGreenInstance("test-instance.domain.com")).toBeFalsy();
    expect(target.isGreenInstance("test-instance-green.domain.com")).toBeFalsy();
    expect(target.isGreenInstance("test-instance-green-1.domain.com")).toBeFalsy();
    expect(target.isGreenInstance("test-instance-green-12345.domain.com")).toBeFalsy();
    expect(target.isGreenInstance("test-instance-green-abcdef.domain.com")).toBeTruthy();
    expect(target.isGreenInstance("test-instance-green-abcdef-.domain.com")).toBeFalsy();
    expect(target.isGreenInstance("test-instance-green-abcdef-12345.domain.com")).toBeFalsy();
    expect(target.isGreenInstance("test-instance-green-abcdef-12345-green.domain.com")).toBeFalsy();
    expect(target.isGreenInstance("test-instance-green-abcdef-12345-green-00000.domain.com")).toBeFalsy();
    expect(target.isGreenInstance("test-instance-green-abcdef-12345-green-000000.domain.com")).toBeTruthy();
  });

  it("test_remove_green_instance_prefix", () => {
    const target = new RdsUtils();
    expect(target.removeGreenInstancePrefix("")).toBe("");
    expect(target.removeGreenInstancePrefix("test-instance")).toBe("test-instance");
    expect(target.removeGreenInstancePrefix("test-instance.domain.com")).toBe("test-instance.domain.com");
    expect(target.removeGreenInstancePrefix("test-instance-green.domain.com")).toBe("test-instance-green.domain.com");
    expect(target.removeGreenInstancePrefix("test-instance-green-1.domain.com")).toBe("test-instance-green-1.domain.com");
    expect(target.removeGreenInstancePrefix("test-instance-green-12345.domain.com")).toBe("test-instance-green-12345.domain.com");
    expect(target.removeGreenInstancePrefix("test-instance-green-abcdef.domain.com")).toBe("test-instance.domain.com");
    expect(target.removeGreenInstancePrefix("test-instance-green-abcdef-.domain.com")).toBe("test-instance-green-abcdef-.domain.com");
    expect(target.removeGreenInstancePrefix("test-instance-green-abcdef-12345.domain.com")).toBe("test-instance-green-abcdef-12345.domain.com");
    expect(target.removeGreenInstancePrefix("test-instance-green-abcdef-12345-green.domain.com")).toBe(
      "test-instance-green-abcdef-12345-green.domain.com"
    );
    expect(target.removeGreenInstancePrefix("test-instance-green-abcdef-12345-green-00000.domain.com")).toBe(
      "test-instance-green-abcdef-12345-green-00000.domain.com"
    );
    expect(target.removeGreenInstancePrefix("test-instance-green-abcdef-12345-green-000000.domain.com")).toBe(
      "test-instance-green-abcdef-12345.domain.com"
    );
    expect(target.removeGreenInstancePrefix("test-instance-green-123456-green-123456.domain.com")).toBe("test-instance-green-123456.domain.com");
  });

  it("test_broken_paths_host_pattern", () => {
    const target = new RdsUtils();
    const incorrectChinaHostPattern = "?.rds.cn-northwest-1.rds.amazonaws.com.cn";
    expect(target.getRdsInstanceHostPattern(extraRdsChinaPath)).toBe(incorrectChinaHostPattern);
    expect(target.getRdsInstanceHostPattern(missingRegionChinaPath)).toBe("?");
  });

  it("test_broken_paths_region", () => {
    // Extra rds path returns correct region.
    const target = new RdsUtils();
    const chinaExpectedRegion = "cn-northwest-1";
    expect(target.getRdsRegion(extraRdsChinaPath)).toBe(chinaExpectedRegion);
    expect(target.getRdsRegion(missingRegionChinaPath)).toBeNull();
  });

  it("test_broken_paths_reader_cluster", () => {
    const target = new RdsUtils();
    expect(target.isReaderClusterDns(extraRdsChinaPath)).toBeFalsy();
    expect(target.isReaderClusterDns(missingCnChinaPath)).toBeFalsy();
    expect(target.isReaderClusterDns(missingRegionChinaPath)).toBeFalsy();
  });

  it("test_broken_paths_writer_cluster", () => {
    // Expected to return true with correct cluster paths.
    const target = new RdsUtils();
    expect(target.isWriterClusterDns(extraRdsChinaPath)).toBeFalsy();
    expect(target.isWriterClusterDns(missingRegionChinaPath)).toBeFalsy();
  });

  it("test_broken_paths_rds_dns", () => {
    // Expected to return true with correct cluster paths.
    const target = new RdsUtils();
    expect(target.isRdsDns(extraRdsChinaPath)).toBeTruthy();
    expect(target.isRdsDns(missingRegionChinaPath)).toBeFalsy();
  });
});
