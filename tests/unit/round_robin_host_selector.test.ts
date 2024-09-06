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

import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { RoundRobinHostSelector } from "../../common/lib/round_robin_host_selector";
import { HostRole } from "../../common/lib/host_role";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { WrapperProperties, WrapperProperty } from "../../common/lib/wrapper_property";

const TEST_PORT = 1234;

const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });

const host0 = "host-0";
const host1 = "host-1";
const host2 = "host-2";
const host3 = "host-3";
const host4 = "host-4";
const instance0 = "instance-0";
const instance1 = "instance-1";
const instance2 = "instance-2";
const instance3 = "instance-3";
const instance4 = "instance-4";
const writerHost = hostInfoBuilder.withHost(host0).withHostId(instance0).withPort(TEST_PORT).withRole(HostRole.WRITER).build();
const readerHost1 = hostInfoBuilder.withHost(host1).withHostId(instance1).withPort(TEST_PORT).withRole(HostRole.READER).build();
const readerHost2 = hostInfoBuilder.withHost(host2).withHostId(instance2).withPort(TEST_PORT).withRole(HostRole.READER).build();
const readerHost3 = hostInfoBuilder.withHost(host3).withHostId(instance3).withPort(TEST_PORT).withRole(HostRole.READER).build();
const readerHost4 = hostInfoBuilder.withHost(host4).withHostId(instance4).withPort(TEST_PORT).withRole(HostRole.READER).build();

// Each number at the end of the host list represents which readers have been added.
const hostsList123 = [writerHost, readerHost2, readerHost3, readerHost1];
const hostsList1234 = [writerHost, readerHost4, readerHost2, readerHost3, readerHost1];
const hostsList13 = [writerHost, readerHost3, readerHost1];
const hostsList14 = [writerHost, readerHost4, readerHost1];
const hostsList23 = [writerHost, readerHost3, readerHost2];
const writerHHostsList = [writerHost];

let roundRobinHostSelector: RoundRobinHostSelector;
let props: Map<string, any>;

describe("round robin host selector tests", () => {
  beforeEach(() => {
    roundRobinHostSelector = new RoundRobinHostSelector();
    props = new Map();
  });

  afterEach(() => {
    roundRobinHostSelector.clearCache();
    props.clear();
  });

  it.each([
    [`${instance0}:1,3,${instance2}:2,${instance3}:3`],
    [`${instance0}:1,${instance1},${instance2}:2,${instance3}:3`],
    [`${instance0}:1,${instance1}:0,${instance2}:2,${instance3}:3`],
    [`${instance0}:1,${instance1}:1:3,${instance2}:2,${instance3}:3`],
    [`${instance0}:1,${instance1}:1.123,${instance2}:2.456,${instance3}:3.789`],
    [`${instance0}:1,${instance1}:-1,${instance2}:-2,${instance3}:-3`],
    [`${instance0}:1,${instance1}:1a,${instance2}:b`]
  ])("test setup with incorrect host weight pairs", async (hostWeights: string) => {
    props.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, hostWeights);
    expect(() => roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props)).toThrow(AwsWrapperError);
  });

  it.each([[0], [1.123], [-1]])("test setup with incorrect default weight", async (defaultWeight: number) => {
    props.set(WrapperProperties.ROUND_ROBIN_DEFAULT_WEIGHT.name, defaultWeight);
    expect(() => roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props)).toThrow(AwsWrapperError);
  });

  it("test getHost no readers", async () => {
    expect(() => roundRobinHostSelector.getHost(writerHHostsList, HostRole.READER, props)).toThrow(AwsWrapperError);
  });

  it("test getHost", async () => {
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
  });

  it("test getHost undefined properties", async () => {
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER).host).toBe(readerHost1.host);
  });

  it("test getHost weighted", async () => {
    const hostWeights = `${instance0}:1,${instance1}:3,${instance2}:2,${instance3}:1`;
    props.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, hostWeights);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
  });

  it("test getHost weight change", async () => {
    const hostWeights = `${instance0}:1,${instance1}:3,${instance2}:2,${instance3}:1`;
    props.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, hostWeights);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);

    const newWeightedProps = new Map();
    const newHostWeights = `${instance0}:1,${instance1}:1,${instance2}:3,${instance3}:2`;
    newWeightedProps.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, newHostWeights);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost1.host);
  });

  it("test getHost host weight pair property change to empty", async () => {
    const emptyHostWeightPairProps = new Map();
    const emptyString = "";
    emptyHostWeightPairProps.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, emptyString);

    const hostWeights = `${instance0}:1,${instance1}:3,${instance2}:2,${instance3}:1`;
    props.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, hostWeights);

    roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props);
    expect(RoundRobinHostSelector.roundRobinCache.get(readerHost1.host)?.clusterWeightsMap.size).toBe(4);
    roundRobinHostSelector.getHost(hostsList123, HostRole.READER, emptyHostWeightPairProps);
    expect(RoundRobinHostSelector.roundRobinCache.get(readerHost1.host)?.clusterWeightsMap.size).toBe(0);
  });

  it("test getHost host weight pair property change to null", async () => {
    const hostWeights = `${instance0}:1,${instance1}:3,${instance2}:2,${instance3}:1`;
    props.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, hostWeights);
    roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props);
    expect(RoundRobinHostSelector.roundRobinCache.get(readerHost1.host)?.clusterWeightsMap.size).toBe(4);
    roundRobinHostSelector.getHost(hostsList123, HostRole.READER, new Map());
    expect(RoundRobinHostSelector.roundRobinCache.get(readerHost1.host)?.clusterWeightsMap.size).toBe(4);
  });

  it("test getHost host weight changed from none", async () => {
    roundRobinHostSelector.getHost(hostsList123, HostRole.READER, new Map());
    expect(RoundRobinHostSelector.roundRobinCache.get(readerHost1.host)?.clusterWeightsMap.size).toBe(0);
    const hostWeights = `${instance0}:1,${instance1}:3,${instance2}:2,${instance3}:1`;
    props.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, hostWeights);
    roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props);
    expect(RoundRobinHostSelector.roundRobinCache.get(readerHost1.host)?.clusterWeightsMap.size).toBe(4);
  });

  it("test getHost host multiple weight changes", async () => {
    const hostWeights = `${instance0}:1,${instance1}:3,${instance2}:2,${instance3}:1`;
    props.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, hostWeights);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);

    const emptyProps = new Map();
    emptyProps.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, "");

    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, emptyProps).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, emptyProps).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, emptyProps).host).toBe(readerHost3.host);

    const newWeightedProps = new Map();
    newWeightedProps.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, `${instance0}:1,${instance1}:1,${instance2}:3,${instance3}:2`);

    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, newWeightedProps).host).toBe(readerHost1.host);
  });

  it("test getHost cache entry expired", async () => {
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    roundRobinHostSelector.clearCache();
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
  });

  it("test getHost scale up", async () => {
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost3.host);
    expect(roundRobinHostSelector.getHost(hostsList1234, HostRole.READER, props).host).toBe(readerHost4.host);
  });

  it("test getHost scale down", async () => {
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList13, HostRole.READER, props).host).toBe(readerHost1.host);
  });

  it("test getHost last host not in hosts list", async () => {
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList123, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList13, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList13, HostRole.READER, props).host).toBe(readerHost3.host);
  });

  it("test getHost all hosts changed", async () => {
    expect(roundRobinHostSelector.getHost(hostsList14, HostRole.READER, props).host).toBe(readerHost1.host);
    expect(roundRobinHostSelector.getHost(hostsList23, HostRole.READER, props).host).toBe(readerHost2.host);
    expect(roundRobinHostSelector.getHost(hostsList14, HostRole.READER, props).host).toBe(readerHost4.host);
  });

  it("test set round robin host weight pairs property", async () => {
    const expectedPropertyValue = `${instance1}:2,${instance2}:1,${instance3}:0`;

    const hosts = [
      hostInfoBuilder.withHost(instance1).withWeight(2).build(),
      hostInfoBuilder.withHost(instance2).withWeight(1).build(),
      hostInfoBuilder.withHost(instance3).withWeight(0).build()
    ];

    RoundRobinHostSelector.setRoundRobinHostWeightPairsProperty(hosts, props);

    const actualPropertyValue = props.get(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name);

    expect(expectedPropertyValue).toBe(actualPropertyValue);
  });
});
