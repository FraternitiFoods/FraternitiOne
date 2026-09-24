"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTasksForCategory, getPresignedUpload, finalizeUpload, type BoqTask } from "./actions";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

type Step =
  | { name: "idle" }
  | { name: "category"; file: File }
  | { name: "task"; file: File; category: string; tasks: BoqTask[]; loading: boolean }
  | { name: "confirm"; file: File; category: string; task: BoqTask; tasks: BoqTask[] }
  | { name: "uploading"; file: File; category: string; task: BoqTask }
  | { name: "error"; message: string };

export function UploadFlow({ projectId, categories }: { projectId: string; categories: string[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep({ name: "idle" });
    setSearch("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChosen(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setStep({ name: "error", message: "File is too large (max 50MB)." });
      return;
    }
    if (!/^image\/|^video\//.test(file.type)) {
      setStep({ name: "error", message: "Only photos and videos can be uploaded." });
      return;
    }
    setStep({ name: "category", file });
  }

  async function handleCategoryPick(file: File, category: string) {
    setStep({ name: "task", file, category, tasks: [], loading: true });
    try {
      const tasks = await getTasksForCategory(projectId, category);
      setStep({ name: "task", file, category, tasks, loading: false });
    } catch {
      setStep({ name: "error", message: "Couldn't load tasks for that category." });
    }
  }

  async function handleSend(file: File, category: string, task: BoqTask) {
    setStep({ name: "uploading", file, category, task });
    try {
      const presign = await getPresignedUpload({
        projectId,
        taskId: task.id,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      });
      if ("error" in presign) {
        setStep({ name: "error", message: presign.error });
        return;
      }

      const putRes = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        setStep({ name: "error", message: "Upload to storage failed. Try again." });
        return;
      }

      const result = await finalizeUpload({
        projectId,
        taskId: task.id,
        key: presign.key,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      });
      if ("error" in result) {
        setStep({ name: "error", message: result.error });
        return;
      }

      reset();
      router.refresh();
    } catch {
      setStep({ name: "error", message: "Something went wrong. Try again." });
    }
  }

  if (step.name === "idle") {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileChosen(file);
          }}
        />
        <Button className="w-full" onClick={() => fileInputRef.current?.click()}>
          Send photo/video
        </Button>
      </>
    );
  }

  if (step.name === "error") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive" role="alert">
          {step.message}
        </p>
        <Button variant="outline" className="w-full" onClick={reset}>
          Try again
        </Button>
      </div>
    );
  }

  if (step.name === "category") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Which category is this for?</p>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories set up for this project yet.</p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => handleCategoryPick(step.file, c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <Button variant="ghost" className="w-full" onClick={reset}>
          Cancel
        </Button>
      </div>
    );
  }

  if (step.name === "task") {
    const q = search.trim().toLowerCase();
    const filtered = q ? step.tasks.filter((t) => t.title.toLowerCase().includes(q)) : step.tasks;
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Which task is this for? ({step.category})</p>
        {step.loading ? (
          <p className="text-sm text-muted-foreground">Loading tasks…</p>
        ) : (
          <>
            <Input
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks match your search.</p>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() =>
                      setStep({ name: "confirm", file: step.file, category: step.category, task: t, tasks: step.tasks })
                    }
                  >
                    {t.title}
                  </button>
                ))
              )}
            </div>
          </>
        )}
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => setStep({ name: "category", file: step.file })}
        >
          Back
        </Button>
      </div>
    );
  }

  if (step.name === "confirm") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Send this?</p>
        <div className="rounded-md border px-3 py-2 text-sm">
          <p className="font-medium">{step.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {step.category} · {step.task.title}
          </p>
        </div>
        <Button className="w-full" onClick={() => handleSend(step.file, step.category, step.task)}>
          Send
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => setStep({ name: "task", file: step.file, category: step.category, tasks: step.tasks, loading: false })}
        >
          Back
        </Button>
      </div>
    );
  }

  // "uploading"
  return <p className="text-center text-sm text-muted-foreground">Sending…</p>;
}
