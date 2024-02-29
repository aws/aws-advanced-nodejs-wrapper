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

import { RdsUtils } from "aws-wrapper-common-lib/lib/utils/rds_utils";

const us_east_region_cluster = "database-test-name.cluster-XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_cluster_read_only = "database-test-name.cluster-ro-XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_instance = "instance-test-name.XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_proxy = "proxy-test-name.proxy-XYZ.us-east-2.rds.amazonaws.com";
const us_east_region_custom_domain = "custom-test-name.cluster-custom-XYZ.us-east-2.rds.amazonaws.com";
const china_region_cluster = "database-test-name.cluster-XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const china_region_cluster_read_only = "database-test-name.cluster-ro-XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const china_region_instance = "instance-test-name.XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const china_region_proxy = "proxy-test-name.proxy-XYZ.rds.cn-northwest-1.amazonaws.com.cn";
const china_region_custom_domain = "custom-test-name.cluster-custom-XYZ.rds.cn-northwest-1.amazonaws.com.cn";

describe("test_rds_utils", () => {
  it.each([[us_east_region_cluster], [us_east_region_cluster_read_only], [china_region_cluster], [china_region_cluster_read_only]])(
    "test_is_rds_cluster_dns",
    (val) => {
      const target = new RdsUtils();
      expect(target.isRdsClusterDns(val)).toBeTruthy();
    }
  );

  it.each([
    [us_east_region_instance],
    [us_east_region_proxy],
    [us_east_region_custom_domain],
    [china_region_instance],
    [china_region_proxy],
    [china_region_custom_domain]
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
    [china_region_cluster],
    [china_region_cluster_read_only],
    [china_region_instance],
    [china_region_proxy],
    [china_region_custom_domain]
  ])("test_is_rds_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isRdsDns(val)).toBeTruthy();
  });

  it.each([
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_cluster],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_cluster_read_only],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_instance],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_proxy],
    ["?.XYZ.us-east-2.rds.amazonaws.com", us_east_region_custom_domain],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_cluster],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_cluster_read_only],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_instance],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_proxy],
    ["?.XYZ.rds.cn-northwest-1.amazonaws.com.cn", china_region_custom_domain]
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
    ["cn-northwest-1", china_region_custom_domain]
  ])("test_get_rds_region", (expected: string, val) => {
    const target = new RdsUtils();
    expect(target.getRdsRegion(val)).toEqual(expected);
  });

  it.each([[us_east_region_cluster], [china_region_cluster]])("test_is_writer_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isWriterClusterDns(val)).toBeTruthy();
  });

  it.each([
    [us_east_region_cluster_read_only],
    [us_east_region_instance],
    [us_east_region_proxy],
    [us_east_region_custom_domain],
    [china_region_cluster_read_only],
    [china_region_instance],
    [china_region_proxy],
    [china_region_custom_domain]
  ])("test_is_not_writer_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isWriterClusterDns(val)).toBeFalsy();
  });

  it.each([[us_east_region_cluster_read_only], [china_region_cluster_read_only]])("test_is_reader_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isReaderClusterDns(val)).toBeTruthy();
  });

  it.each([
    [us_east_region_cluster],
    [us_east_region_instance],
    [us_east_region_proxy],
    [us_east_region_custom_domain],
    [china_region_cluster],
    [china_region_instance],
    [china_region_proxy],
    [china_region_custom_domain]
  ])("test_is_not_reader_cluster_dns", (val) => {
    const target = new RdsUtils();
    expect(target.isReaderClusterDns(val)).toBeFalsy();
  });

  it("test_get_rds_cluster_host_url", () => {
    const expected: string = "foo.cluster-xyz.us-west-1.rds.amazonaws.com";
    const expected2: string = "foo-1.cluster-xyz.us-west-1.rds.amazonaws.com.cn";
    const ro_endpoint: string = "foo.cluster-ro-xyz.us-west-1.rds.amazonaws.com";
    const china_ro_endpoint: string = "foo-1.cluster-ro-xyz.us-west-1.rds.amazonaws.com.cn";

    const target = new RdsUtils();
    expect(target.getRdsClusterHostUrl(ro_endpoint)).toEqual(expected);
    expect(target.getRdsClusterHostUrl(china_ro_endpoint)).toEqual(expected2);
  });
});
