"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/format";
import type { TeamData } from "@/lib/dashboard-data";
import { setUserSiteAssignments } from "../../../actions";

type Person = TeamData["people"][number];

const SELECT_CLASS =
  "h-9 min-w-56 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Tri-state "whole stage" checkbox: checked = every task ticked, indeterminate = some. */
function StageCheckbox({ checked, indeterminate, label, onChange }: { checked: boolean; indeterminate: boolean; label: string; onChange: (next: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      className="size-4 shrink-0 accent-sky-500"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/**
 * Admin's assignment picker for one website-created site (plan.md section 12).
 * The picker edits a local selection for ONE person at a time; Save sends the
 * complete set of task ids to setUserSiteAssignments, which replaces what that
 * person holds on this site. The server re-validates everything.
 */
export function TeamManager({
  siteId,
  stages,
  people,
  initialAssigned,
}: {
  siteId: string;
  stages: TeamData["stages"];
  people: Person[];
  initialAssigned: Record<string, string[]>;
}) {
  const router = useRouter();
  const [assigned, setAssigned] = useState<Record<string, string[]>>(initialAssigned);
  const [userId, setUserId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const stageOfStep = useMemo(() => {
    const map = new Map<string, number>();
    for (const stage of stages) for (const step of stage.steps) map.set(step.id, stage.stageNo);
    return map;
  }, [stages]);

  const saved = new Set(assigned[userId] ?? []);
  const dirty = userId !== "" && (selected.size !== saved.size || [...selected].some((id) => !saved.has(id)));
  const team = people.filter((p) => (assigned[p.id]?.length ?? 0) > 0);

  function choosePerson(id: string) {
    setUserId(id);
    const ids = new Set(assigned[id] ?? []);
    setSelected(ids);
    // Open the stages this person already works in.
    setExpanded(new Set([...ids].map((stepId) => stageOfStep.get(stepId)).filter((n): n is number => n !== undefined)));
  }

  function toggleStep(stepId: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(stepId);
      else next.delete(stepId);
      return next;
    });
  }

  function toggleStage(stage: TeamData["stages"][number], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const step of stage.steps) {
        if (on) next.add(step.id);
        else next.delete(step.id);
      }
      return next;
    });
  }

  function toggleExpanded(stageNo: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(stageNo)) next.delete(stageNo);
      else next.add(stageNo);
      return next;
    });
  }

  async function persist(personId: string, stepIds: string[], doneMessage: string) {
    setSaving(true);
    try {
      const result = await setUserSiteAssignments(siteId, personId, stepIds);
      if (result?.error) throw new Error(result.error);
      setAssigned((prev) => {
        const next = { ...prev };
        if (stepIds.length > 0) next[personId] = stepIds;
        else delete next[personId];
        return next;
      });
      toast.success(doneMessage);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Could not save. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!userId) return;
    await persist(userId, [...selected], "Assignments saved.");
  }

  async function remove(personId: string) {
    const ok = await persist(personId, [], "Removed from this site.");
    if (ok && personId === userId) setSelected(new Set());
  }

  function stageCounts(personId: string) {
    const counts = new Map<number, number>();
    for (const stepId of assigned[personId] ?? []) {
      const stageNo = stageOfStep.get(stepId);
      if (stageNo !== undefined) counts.set(stageNo, (counts.get(stageNo) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Team on this site</CardTitle>
        </CardHeader>
        <CardContent>
          {team.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is assigned yet. Pick a person below and tick their stages or tasks.</p>
          ) : (
            <ul className="divide-y" data-testid="team-list">
              {team.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <Badge variant="outline">{ROLE_LABELS[p.role as Role]}</Badge>
                      {!p.isActive && <Badge variant="outline">Deactivated</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      {stageCounts(p.id).map(([stageNo, count]) => (
                        <span key={stageNo} className="rounded-full bg-muted px-2 py-0.5">
                          Stage {stageNo}: {count}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" disabled={saving} onClick={() => choosePerson(p.id)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={saving} onClick={() => void remove(p.id)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Assign tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Person"
              className={SELECT_CLASS}
              value={userId}
              disabled={saving}
              onChange={(e) => choosePerson(e.target.value)}
            >
              <option value="">Select a person…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {ROLE_LABELS[p.role as Role]}
                  {(assigned[p.id]?.length ?? 0) > 0 ? ` (${assigned[p.id].length} tasks)` : ""}
                </option>
              ))}
            </select>
            {userId && (
              <>
                <span className="text-sm text-muted-foreground">{selected.size} task{selected.size === 1 ? "" : "s"} selected</span>
                <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                {dirty && (
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => choosePerson(userId)}>
                    Discard changes
                  </Button>
                )}
              </>
            )}
          </div>

          {!userId ? (
            <p className="text-sm text-muted-foreground">
              Pick a person, tick a whole stage to give them every task in it, then untick the ones they shouldn&apos;t work on.
              They can open a stage once they hold at least one task in it.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10" data-testid="stage-picker">
              {stages.map((stage) => {
                const ticked = stage.steps.filter((s) => selected.has(s.id)).length;
                const all = ticked === stage.steps.length && stage.steps.length > 0;
                const open = expanded.has(stage.stageNo);
                return (
                  <div key={stage.stageNo} className="border-b last:border-b-0">
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      <StageCheckbox
                        checked={all}
                        indeterminate={ticked > 0 && !all}
                        label={`Assign whole Stage ${stage.stageNo}`}
                        onChange={(on) => toggleStage(stage, on)}
                      />
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left text-sm"
                        aria-expanded={open}
                        onClick={() => toggleExpanded(stage.stageNo)}
                      >
                        <span className="truncate font-medium">
                          Stage {stage.stageNo} — {stage.stageName}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {ticked}/{stage.steps.length} {open ? "−" : "+"}
                        </span>
                      </button>
                    </div>
                    {open && (
                      <ul className="space-y-1 bg-muted/30 px-4 py-2 pl-11">
                        {stage.steps.map((step) => (
                          <li key={step.id}>
                            <label className="flex cursor-pointer items-start gap-2 py-0.5 text-sm">
                              <input
                                type="checkbox"
                                className="mt-0.5 size-4 shrink-0 accent-sky-500"
                                aria-label={`Assign task: ${step.label}`}
                                checked={selected.has(step.id)}
                                onChange={(e) => toggleStep(step.id, e.target.checked)}
                              />
                              <span>{step.label}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
