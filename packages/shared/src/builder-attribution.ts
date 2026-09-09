import { Attribution } from "ox/erc8021";

/** Base Builder Code registered to the Vector app. */
export const VECTOR_BUILDER_CODE = "bc_wm9pyn6y" as const;

/** Schema 0 ERC-8021 suffix appended to every Vector Smart Account UserOperation. */
export const VECTOR_BUILDER_DATA_SUFFIX = Attribution.toDataSuffix({
  codes: [VECTOR_BUILDER_CODE],
});
