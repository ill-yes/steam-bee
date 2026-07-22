import { dataDirectory } from "./data-directory.js";
import { InstanceLease } from "./instance-lease.js";

export const instanceLease = new InstanceLease(dataDirectory);
