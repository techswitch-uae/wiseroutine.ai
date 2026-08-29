import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Tear the DOM down between tests.
 *
 * Testing Library registers this itself when the test runner exposes globals,
 * and this one does not - so without it every `render` piles into the same
 * `document.body` and stays there. Nothing notices until two tests, or one
 * test rendering twice, both contain something matched by role: the query then
 * finds several and fails on a page that looks perfectly correct in isolation.
 *
 * It is a property of the suite rather than of any test, which is why it lives
 * here instead of in the file that happened to trip over it.
 */
afterEach(cleanup);
