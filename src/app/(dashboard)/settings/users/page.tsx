"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Trash2, UserCog, Search, Shield, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { toast } from "sonner";
import { isSystemAdminRole } from "@/lib/roles";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/* ── Confirm Modal ── */
function ConfirmModal({ title, message, danger, onConfirm, onCancel }: {
  title: string; message: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="app-overlay fixed inset-0 z-50 flex items-center justify-center">
      <div className="rounded-2xl w-[400px] max-w-[90vw] overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}>
        <div className="px-5 py-4">
          <h3 className="text-[14px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>{title}</h3>
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{message}</p>
        </div>
        <div className="flex gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
          <button onClick={onCancel} className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "none" }}>Cancel</button>
          <button onClick={onConfirm} className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white" style={{ background: danger ? "var(--color-danger)" : "var(--color-action)" }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

/* ── Role Picker Modal ── */
function RolePickerModal({ userName, onSelect, onCancel }: {
  userName: string; onSelect: (role: string) => void; onCancel: () => void;
}) {
  const [role, setRole] = useState("Staff");
  return (
    <div className="app-overlay fixed inset-0 z-50 flex items-center justify-center">
      <div className="rounded-2xl w-[380px] max-w-[90vw] overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}>
        <div className="px-5 py-4">
          <h3 className="text-[14px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>Set Role</h3>
          <p className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>Choose a role for {userName}</p>
          <div className="flex flex-col gap-1.5">
            {["Staff", "Viewer", "IT Admin", "System Admin"].map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border-none text-left text-[12px] font-medium"
                style={{ background: role === r ? "var(--nav-active-bg)" : "transparent", color: role === r ? "var(--nav-active-text)" : "var(--text-primary)" }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
          <button onClick={onCancel} className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "none" }}>Cancel</button>
          <button onClick={() => onSelect(role)} className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white" style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}>Add as {role}</button>
        </div>
      </div>
    </div>
  );
}

/* ── AD Search Modal (Codex-style) ── */
interface ADResult { email: string; name: string; jobTitle: string | null; department: string | null; photo?: string | null }

function ADSearchModal({ onClose, onSelect, existingEmails, title }: {
  onClose: () => void;
  onSelect: (email: string, name: string) => void;
  existingEmails?: string[];
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ADResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); setError(null); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true); setError(null);
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        if (json.ok) setResults(json.data ?? []);
        else throw new Error(json.error || "Search failed");
      } catch (err) { setError(err instanceof Error ? err.message : "Search failed"); setResults([]); }
      finally { setSearching(false); }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const existing = new Set((existingEmails ?? []).map((e) => e.toLowerCase()));

  return (
    <div className="app-overlay fixed inset-0 z-50 flex items-center justify-center">
      <div className="rounded-2xl w-[560px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden" style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-modal)", border: "1px solid var(--border-card)" }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border-card)" }}>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>{title ?? "Search Active Directory"}</h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Find users from Microsoft Entra ID</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
            <span className="text-[14px]">✕</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a name or email..."
              className="flex-1 text-[13px] outline-none bg-transparent"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {query.trim().length < 2 ? (
            <div className="py-10 text-center">
              <p className="text-[20px] mb-2">☁️</p>
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>Type at least 2 characters to search</p>
            </div>
          ) : searching ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>Searching Entra ID...</p>
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>{error}</p>
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>No users found for "{query}"</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>{results.length} results</p>
              {results.map((u) => {
                const added = existing.has(u.email.toLowerCase());
                return (
                  <div key={u.email} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ border: `1px solid ${added ? "color-mix(in srgb, var(--status-ok-text) 30%, transparent)" : "var(--border-card)"}`, background: added ? "var(--status-ok-bg)" : "var(--bg-card)" }}>
                    {u.photo ? (
                      <img src={u.photo} alt={u.name} className="w-9 h-9 rounded-full shrink-0 object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: added ? "color-mix(in srgb, var(--status-ok-text) 20%, transparent)" : "var(--nav-active-bg)", color: added ? "var(--status-ok-text)" : "var(--nav-active-text)" }}>
                        {u.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{u.name}</p>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {u.email}{u.jobTitle ? ` · ${u.jobTitle}` : ""}{u.department ? ` · ${u.department}` : ""}
                      </p>
                    </div>
                    {added ? (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-lg" style={{ color: "var(--status-ok-text)", background: "var(--status-ok-bg)" }}>Added</span>
                    ) : (
                      <button
                        onClick={() => { onSelect(u.email, u.name); onClose(); }}
                        className="text-[11px] font-bold px-3 py-1 rounded-lg cursor-pointer border-none"
                        style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
                      >
                        + Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface User {
  id: number;
  name: string;
  nickname: string;
  email: string;
  role: string;
}

export default function SettingsUsersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isSystemAdmin = isSystemAdminRole(session?.user?.role);

  const { data, mutate } = useSWR<{ ok: boolean; data: { users: User[] } }>(
    "/api/settings/users", fetcher,
  );
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [rolePickerFor, setRolePickerFor] = useState<{ email: string; name: string } | null>(null);

  useEffect(() => {
    if (status === "authenticated" && !isSystemAdmin) {
      router.replace("/settings");
    }
  }, [status, isSystemAdmin, router]);

  const users = data?.data?.users ?? [];

  const doAction = async (action: string, body: Record<string, unknown>) => {
    const res = await fetch("/api/settings/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("Done");
      mutate();
    } else {
      toast.error(json.error ?? "Failed");
    }
  };

  if (status === "loading" || (status === "authenticated" && !isSystemAdmin)) {
    return (
      <PageContainer className="py-12 flex justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Shield}
        title="Users & Roles"
        subtitle="จัดการผู้ใช้ บทบาท และการซิงก์จาก Active Directory"
        backHref="/settings"
      />

      {/* ── User Role Management (System Admin only) ── */}
      {isSystemAdmin && (
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <div className="flex items-center gap-2 mb-3">
            <UserCog size={16} style={{ color: "var(--text-heading)" }} />
            <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--text-heading)" }}>User Roles</h2>
            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{users.length} users</span>
            <button
              onClick={async () => {
                toast.info("Resyncing all users from AD...");
                const res = await fetch("/api/settings/users", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "resyncAll" }),
                });
                const json = await res.json();
                if (json.ok) {
                  toast.success(`Resynced ${json.data?.synced ?? 0} of ${json.data?.total ?? 0} users`);
                  mutate();
                } else {
                  toast.error(json.error ?? "Failed");
                }
              }}
              className="text-[10px] font-medium px-2.5 py-1 rounded-lg cursor-pointer border-none"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
            >
              Resync All from AD
            </button>
          </div>

          {/* Add user from AD */}
          <div className="mb-4">
            <button
              onClick={() => setShowAddUserModal(true)}
              className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
              style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
            >
              <Plus size={12} /> Add User from AD
            </button>
          </div>
          {showAddUserModal && (
            <ADSearchModal
              title="Add User from Active Directory"
              onClose={() => setShowAddUserModal(false)}
              onSelect={(email, name) => {
                setShowAddUserModal(false);
                setRolePickerFor({ email, name });
              }}
              existingEmails={users.map((u) => u.email)}
            />
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-header)" }}>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Name</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Email</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Role</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, idx) => (
                  <tr
                    key={u.id}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{ borderBottom: "1px solid var(--border-light)", background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined }}
                  >
                    <td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                      {u.name}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--text-muted)" }}>{u.email}</td>
                    <td className="px-4 py-2">
                      {session?.user?.email?.toLowerCase() === u.email.toLowerCase() ? (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={
                            u.role === "System Admin"
                              ? { background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }
                              : { background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }
                          }
                        >
                          {u.role} (you)
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) => {
                            const newRole = e.target.value;
                            if (newRole !== u.role) {
                              setConfirmAction({ title: "Change Role", message: `Change ${u.name} from "${u.role}" to "${newRole}"?`, onConfirm: () => { doAction("updateRole", { targetUserId: u.id, newRole }); setConfirmAction(null); } });
                            }
                          }}
                          className="rounded-lg px-2 py-1 text-[11px] outline-none"
                          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                        >
                          <option value="Staff">Staff</option>
                          <option value="Viewer">Viewer</option>
                          <option value="IT Admin">IT Admin</option>
                          <option value="System Admin">System Admin</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        {session?.user?.email?.toLowerCase() !== u.email.toLowerCase() && (
                          <button
                            onClick={() => {
                              setConfirmAction({ title: "Deactivate User", message: `Deactivate ${u.name} (${u.email})? They will no longer be able to log in.`, danger: true, onConfirm: () => { doAction("deleteUser", { targetUserId: u.id }); setConfirmAction(null); } });
                            }}
                            className="cursor-pointer bg-transparent border-none p-0.5"
                            style={{ color: "var(--text-faint)" }}
                            title="Deactivate user"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Modals */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          danger={confirmAction.danger}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {rolePickerFor && (
        <RolePickerModal
          userName={rolePickerFor.name}
          onSelect={(role) => { doAction("addUser", { name: rolePickerFor.name, email: rolePickerFor.email, role }); setRolePickerFor(null); }}
          onCancel={() => setRolePickerFor(null)}
        />
      )}
    </PageContainer>
  );
}
