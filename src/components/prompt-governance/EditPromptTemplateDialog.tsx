import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PromptTemplate } from "@/hooks/usePromptGovernance";

const PROMPT_TYPES = ["enrichment", "description", "seo", "categorization", "validation", "translation", "general"];

interface Props {
  template: PromptTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: { id: string; prompt_name?: string; prompt_type?: string; base_prompt?: string; description?: string; is_active?: boolean }) => void;
  saving?: boolean;
}

export function EditPromptTemplateDialog({ template, open, onOpenChange, onSave, saving }: Props) {
  const [form, setForm] = useState({ prompt_name: "", prompt_type: "general", base_prompt: "", description: "", is_active: true });

  useEffect(() => {
    if (template) {
      setForm({
        prompt_name: template.prompt_name,
        prompt_type: template.prompt_type,
        base_prompt: template.base_prompt,
        description: template.description || "",
        is_active: template.is_active,
      });
    }
  }, [template]);

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader><DialogTitle>Editar Template</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={form.prompt_name} onChange={e => setForm(f => ({ ...f, prompt_name: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={form.prompt_type} onValueChange={v => setForm(f => ({ ...f, prompt_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROMPT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Prompt Base</Label>
            <Textarea value={form.base_prompt} onChange={e => setForm(f => ({ ...f, base_prompt: e.target.value }))} rows={6} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
            <Label>Ativo</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => { onSave({ id: template.id, ...form }); onOpenChange(false); }} disabled={saving || !form.prompt_name}>
            Guardar Alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
