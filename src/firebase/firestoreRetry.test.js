jest.mock("./config", () => ({
  auth: {
    currentUser: {
      getIdToken: jest.fn(),
    },
  },
}));

import { auth } from "./config";
import { runWithFreshAuthRetry } from "./firestoreRetry";

describe("runWithFreshAuthRetry", () => {
  beforeEach(() => {
    auth.currentUser = {
      getIdToken: jest.fn().mockResolvedValue("token"),
    };
  });

  it("returns the original result without retry when the operation succeeds", async () => {
    const operation = jest.fn().mockResolvedValue("ok");

    await expect(runWithFreshAuthRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(auth.currentUser.getIdToken).not.toHaveBeenCalled();
  });

  it("refreshes the token and retries once on permission denied", async () => {
    const error = Object.assign(new Error("permission denied"), { code: "permission-denied" });
    const operation = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("recovered");

    await expect(runWithFreshAuthRetry(operation)).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(auth.currentUser.getIdToken).toHaveBeenCalledWith(true);
  });

  it("rethrows non-retryable errors", async () => {
    const error = Object.assign(new Error("boom"), { code: "unavailable" });
    const operation = jest.fn().mockRejectedValue(error);

    await expect(runWithFreshAuthRetry(operation)).rejects.toThrow("boom");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(auth.currentUser.getIdToken).not.toHaveBeenCalled();
  });
});
