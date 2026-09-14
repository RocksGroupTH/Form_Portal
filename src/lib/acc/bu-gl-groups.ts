/**
 * The **Fix G/L by BU or Branch** settings screen, turned the right way round.
 *
 * Shared by AP-3 and AP-4 — one screen over one set of rows, since 2026-09-14.
 * It lives in `lib/acc` rather than under either feature for that reason, and
 * because it is pure: the regrouping is a rule about the data, not about a form.
 *
 * The database stores **one row per thing being redirected** — `AccClrBuGlMap`
 * is `(Company, BuCode) → G/L` and `AccClrBranchGlMap` is `(Company,
 * BranchCode) → G/L`. AP-3's screen shows exactly that: a row per BU with a
 * box to type an account into.
 *
 * The question an accountant actually asks is the other one — *which shops book
 * to this receivable?* — so this module regroups the same rows by the account
 * they point at, and the screen adds and removes members of a group.
 *
 * **A "group" does not exist in the database.** It is the accounts that happen
 * to be named by one or more rules. So a group with no members cannot be
 * stored, and removing a group's last member makes the group disappear — both
 * are consequences of the schema rather than of the screen, and the screen says
 * so rather than pretending otherwise.
 *
 * **The two tables are one thing here.** They are separate storage because some
 * branches have no BU to key on — `RFM` is a BRANCH dimension value with no
 * Location behind it — not because they are different kinds of decision. Each
 * member therefore carries its `kind`, which is the only thing the save needs
 * in order to pick a table.
 *
 * Pure and import-free, so the regrouping is unit-tested without a database or
 * a DOM.
 */

export type MemberKind = "bu" | "branch";

export interface BuRuleRow {
  buCode: string;
  glAccountNo: string;
  isActive: boolean;
}

export interface BranchRuleRow {
  branchCode: string;
  glAccountNo: string;
  isActive: boolean;
}

/** A BU the Company's Locations actually carry, and how many. */
export interface BuRow {
  buCode: string;
  locations: number;
}

export interface AccountRow {
  accountNo: string;
  displayName: string | null;
}

export interface GroupingInput {
  buRules: readonly BuRuleRow[];
  branchRules: readonly BranchRuleRow[];
  bus: readonly BuRow[];
  accounts: readonly AccountRow[];
}

export interface GroupMember {
  kind: MemberKind;
  code: string;
  /** `kind:code`, the key the picker and the save both address a member by. */
  key: string;
}

export interface AccountGroup {
  accountNo: string;
  /** Null when the account list does not name it — see the module note. */
  displayName: string | null;
  members: GroupMember[];
}

export interface Grouping {
  groups: AccountGroup[];
  /** BUs the Locations carry that no rule names, largest first. */
  unassignedBus: BuRow[];
  /** `kind:code` → the account it currently sits in, so the picker can say "move". */
  assignedAccountByCode: Map<string, string>;
}

const memberKey = (kind: MemberKind, code: string) => `${kind}:${code}`;

/** A rule counts only while it is active and actually names an account. */
function live(glAccountNo: string, isActive: boolean): string | null {
  if (!isActive) return null;
  const gl = (glAccountNo ?? "").trim();
  // Blank IS the delete — "บัญชีตาม คชจ", the absence of a rule — so a blank
  // row must not become a group with an empty heading.
  return gl === "" ? null : gl;
}

export function groupRulesByAccount(input: GroupingInput): Grouping {
  const nameByAccount = new Map(input.accounts.map((a) => [a.accountNo.trim(), a.displayName]));
  const byAccount = new Map<string, GroupMember[]>();
  const assignedAccountByCode = new Map<string, string>();
  const ruledBus = new Set<string>();

  const add = (kind: MemberKind, rawCode: string, gl: string) => {
    const code = (rawCode ?? "").trim();
    if (code === "") return;
    const list = byAccount.get(gl) ?? [];
    list.push({ kind, code, key: memberKey(kind, code) });
    byAccount.set(gl, list);
    assignedAccountByCode.set(memberKey(kind, code), gl);
  };

  for (const r of input.buRules) {
    const gl = live(r.glAccountNo, r.isActive);
    if (!gl) continue;
    add("bu", r.buCode, gl);
    ruledBus.add((r.buCode ?? "").trim().toUpperCase());
  }
  for (const r of input.branchRules) {
    const gl = live(r.glAccountNo, r.isActive);
    if (!gl) continue;
    add("branch", r.branchCode, gl);
  }

  const groups: AccountGroup[] = Array.from(byAccount.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((accountNo) => ({
      accountNo,
      displayName: nameByAccount.get(accountNo) ?? null,
      members: (byAccount.get(accountNo) ?? []).sort(
        // BUs first: a BU names a KIND of shop where a branch names one shop,
        // so the general rule reads before the exceptions to it.
        (a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === "bu" ? -1 : 1),
      ),
    }));

  const unassignedBus = input.bus
    .filter((b) => !ruledBus.has((b.buCode ?? "").trim().toUpperCase()))
    // Largest first: the size of a BU is what says whether a missing rule
    // matters, and an alphabetical list buries the one to look at.
    .slice()
    .sort((a, b) => b.locations - a.locations || a.buCode.localeCompare(b.buCode));

  return { groups, unassignedBus, assignedAccountByCode };
}
