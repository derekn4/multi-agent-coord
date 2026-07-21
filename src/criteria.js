// src/criteria.js
//
// The closed vocabulary the verifier grades against. The coordinator can't run a
// task's JavaScript check() across a process boundary, so completion criteria
// arrive as DATA and are evaluated here against a store snapshot.
//
// Two rules keep it honest: every failure returns a reason naming the key and
// the gap (that string IS the agent's retry feedback), and an unrecognized
// criterion FAILS rather than silently waving bad work through.

// Render a value for a reason string: 'done' quoted, or a bare undefined for a
// missing key (so "got undefined" reads as absence, not as the string "undefined").
const q = (v) => (v === undefined ? 'undefined' : `'${v}'`);

/**
 * Grade a list of criteria against a store snapshot.
 *
 * @param {Array<object>} criteria  the closed vocabulary, see evaluateOne
 * @param {{state: object, messages: Array<object>}} data  an in-lock readAll() snapshot
 * @returns {string[]} one reason per FAILED criterion; [] means everything passed
 *
 * Note: report EVERY failure, not just the first. An agent that only learns
 * about one problem per round trip burns both its attempts fast.
 */
export function evaluateCriteria(criteria, data) {
  return criteria.map((c) => evaluateOne(c, data)).filter((r) => r !== null);
}

/**
 * Grade ONE criterion. Returns null if it holds, else a reason string.
 *
 * The four supported shapes:
 *   { state_key, equals }         -> that key holds exactly that value
 *   { state_key, exists: true }   -> that key is set to anything
 *   { message_to, from }          -> >=1 message to that recipient from that sender
 *   { message_to, body_contains } -> >=1 such message whose body contains the text
 *
 * Anything else is unsupported and must FAIL (rule 2 above).
 */
function evaluateOne(c, data) {
  // -- state predicates ------------------------------------------------------
  if (c.state_key !== undefined) {
    const actual = data.state[c.state_key];
    if (c.equals !== undefined) {
      if (actual === c.equals) return null;
      return `state_key ${c.state_key}: expected ${q(c.equals)}, got ${q(actual)}`;
    }

    if (c.exists === true) {
      if (actual !== undefined) return null;
      return `state_key ${c.state_key}: expected it to be set, but it is missing`;
    }
    return `unsupported criterion: ${JSON.stringify(c)}`;
  }

  // -- message predicates ----------------------------------------------------
  if (c.message_to !== undefined) {
    const inbox = data.messages.filter((m) => m.to === c.message_to || m.to === 'all');
    if (c.from !== undefined) {
      if (!inbox.some((m) => m.from === c.from)) {
        return `message_to ${c.message_to} from ${c.from}: no matching message`;
      }
      return null;
    }

    if (c.body_contains !== undefined) {
      if (!inbox.some((m) => String(m.body).includes(c.body_contains))) {
        return `message_to ${c.message_to} body_contains ${q(c.body_contains)}: no matching message`;
      }
      return null;
    }

    return `unsupported criterion: ${JSON.stringify(c)}`;
  }

  // Neither a state nor a message criterion -- we have no idea what this is.
  return `unsupported criterion: ${JSON.stringify(c)}`;
}
