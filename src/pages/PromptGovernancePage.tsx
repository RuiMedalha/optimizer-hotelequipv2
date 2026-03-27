import { useState } from "react";
import { usePromptGovernance, type PromptTemplate, type PromptVersion } from "@/hooks/usePromptGovernance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, FileCode, Cog, Wrench } from "lucide-react";
import { PromptTemplatesTable } from "@/components/prompt-governance/PromptTemplatesTable";
import { EditPromptTemplateDialog } from "@/components/prompt-governance/EditPromptTemplateDialog";
import { PromptVersionHistoryPanel } from "@/components/prompt-governance/PromptVersionHistoryPanel";
import { PromptVersionCompareDialog } from "@/components/prompt-governance/PromptVersionCompareDialog";
import { PromptPerformancePanel } from "@/components/prompt-governance/PromptPerformancePanel";
import { ConfirmArchiveDialog } from "@/components/prompt-governance/ConfirmArchiveDialog";
import { ConfirmDeleteDialog } from "@/components/prompt-governance/ConfirmDeleteDialog";

// System prompts = general (core behavior instructions)
// Service prompts = task-specific (enrichment, description, seo, categorization, validation, translation)
const PROMPT_TYPES = ["enrichment", "description", "seo", "categorization", "validation", "translation", "general"];
const SYSTEM_TYPES = ["general"];
const SERVICE_TYPES = ["enrichment", "description", "seo", "categorization", "validation", "translation"];

export default function PromptGovernancePage() {
  const {
    templates, createTemplate, updateTemplate, archiveTemplate, restoreTemplate,
    deleteTemplate, duplicateTemplate, useVersions, createVersion, activateVersion,
    usageLogs, useVersionPerformance,
  } = usePromptGovernance();

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("system");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ prompt_name: "", prompt_type: "general", base_prompt: "", description: "" });

  // Edit dialog
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);

  // Confirm dialogs
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Compare
  const [compareVersions, setCompareVersions] = useState<[PromptVersion | null, PromptVersion | null]>([null, null]);

  // New version
  const [newVersionText, setNewVersionText] = useState("");
  const [newVersionNotes, setNewVersionNotes] = useState("");

  const versions = useVersions(selectedTemplate);
  const logs = usageLogs(selectedVersion);
  const performance = useVersionPerformance(selectedVersion);

  const selectedTpl = templates.data?.find(t => t.id === selectedTemplate);

  const systemTemplates = (templates.data || []).filter(t => SYSTEM_TYPES.includes(t.prompt_type));
  const serviceTemplates = (templates.data || []).filter(t => SERVICE_TYPES.includes(t.prompt_type));

  const handleSelectTemplate = (id: string) => {
    setSelectedTemplate(id);
    setSelectedVersion(null);
    setActiveTab("versions");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCode className="w-6 h-6" /> Prompt Governance
          </h1>
          <p className="text-muted-foreground">Gestão de prompts de sistema (comportamento base) e prompts de serviço (tarefas específicas)</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 mr-1" /> Novo Template
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{systemTemplates.length}</p>
          <p className="text-xs text-muted-foreground">Prompts de Sistema</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{serviceTemplates.length}</p>
          <p className="text-xs text-muted-foreground">Prompts de Serviço</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{(templates.data || []).filter(t => t.is_active).length}</p>
          <p className="text-xs text-muted-foreground">Ativos</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{templates.data?.length || 0}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </CardContent></Card>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardHeader><CardTitle className="text-base">Novo Template</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nome do prompt" value={newTemplate.prompt_name} onChange={e => setNewTemplate(f => ({ ...f, prompt_name: e.target.value }))} className="flex-1" />
              <Select value={newTemplate.prompt_type} onValueChange={v => setNewTemplate(f => ({ ...f, prompt_type: v }))}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general" className="font-medium">⚙️ Sistema — general</SelectItem>
                  {SERVICE_TYPES.map(t => <SelectItem key={t} value={t}>🔧 Serviço — {t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Descrição" value={newTemplate.description} onChange={e => setNewTemplate(f => ({ ...f, description: e.target.value }))} />
            <Textarea placeholder="Prompt base..." value={newTemplate.base_prompt} onChange={e => setNewTemplate(f => ({ ...f, base_prompt: e.target.value }))} rows={4} />
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  createTemplate.mutate(newTemplate);
                  setNewTemplate({ prompt_name: "", prompt_type: "general", base_prompt: "", description: "" });
                  setShowCreate(false);
                }}
                disabled={!newTemplate.prompt_name || !newTemplate.base_prompt || createTemplate.isPending}
              >
                <Plus className="w-4 h-4 mr-1" /> Criar
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="system" className="gap-1.5">
            <Cog className="h-4 w-4" /> Sistema ({systemTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="service" className="gap-1.5">
            <Wrench className="h-4 w-4" /> Serviço ({serviceTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="versions" disabled={!selectedTemplate}>
            Versões {selectedTpl ? `— ${selectedTpl.prompt_name}` : ""}
          </TabsTrigger>
          <TabsTrigger value="performance" disabled={!selectedVersion}>Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="system" className="mt-4">
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <Cog className="w-4 h-4 inline mr-1" />
              <strong>Prompts de Sistema</strong> definem o comportamento base da IA — instruções gerais, tom de escrita, regras de idioma e formato de saída.
            </p>
          </div>
          <PromptTemplatesTable
            templates={systemTemplates}
            selectedId={selectedTemplate}
            onSelect={handleSelectTemplate}
            onEdit={t => setEditingTemplate(t)}
            onDuplicate={id => duplicateTemplate.mutate(id)}
            onArchive={id => setArchiveId(id)}
            onRestore={id => restoreTemplate.mutate(id)}
            onDelete={id => setDeleteId(id)}
          />
        </TabsContent>

        <TabsContent value="service" className="mt-4">
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <Wrench className="w-4 h-4 inline mr-1" />
              <strong>Prompts de Serviço</strong> são especializados por tarefa — enrichment, SEO, descrições, categorização, validação e tradução. São ligados às regras de routing no AI Provider Center.
            </p>
          </div>
          <PromptTemplatesTable
            templates={serviceTemplates}
            selectedId={selectedTemplate}
            onSelect={handleSelectTemplate}
            onEdit={t => setEditingTemplate(t)}
            onDuplicate={id => duplicateTemplate.mutate(id)}
            onArchive={id => setArchiveId(id)}
            onRestore={id => restoreTemplate.mutate(id)}
            onDelete={id => setDeleteId(id)}
          />
        </TabsContent>

        <TabsContent value="versions" className="space-y-4 mt-4">
          {!selectedTemplate ? (
            <p className="text-muted-foreground">Selecione um template.</p>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Nova Versão</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Textarea placeholder="Texto do prompt..." value={newVersionText} onChange={e => setNewVersionText(e.target.value)} rows={4} />
                  <Input placeholder="Notas da versão (opcional)" value={newVersionNotes} onChange={e => setNewVersionNotes(e.target.value)} />
                  <Button
                    size="sm"
                    onClick={() => {
                      createVersion.mutate({ template_id: selectedTemplate!, prompt_text: newVersionText, version_notes: newVersionNotes || undefined });
                      setNewVersionText("");
                      setNewVersionNotes("");
                    }}
                    disabled={!newVersionText || createVersion.isPending}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Criar Versão
                  </Button>
                </CardContent>
              </Card>

              <PromptVersionHistoryPanel
                versions={versions.data || []}
                selectedVersionId={selectedVersion}
                onSelectVersion={id => { setSelectedVersion(id); }}
                onActivateVersion={versionId => activateVersion.mutate({ template_id: selectedTemplate!, version_id: versionId })}
                onCompareVersions={(a, b) => setCompareVersions([a, b])}
                templateId={selectedTemplate!}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <PromptPerformancePanel
            performance={performance.data}
            logs={logs.data || []}
            loading={performance.isLoading}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <EditPromptTemplateDialog
        template={editingTemplate}
        open={!!editingTemplate}
        onOpenChange={open => { if (!open) setEditingTemplate(null); }}
        onSave={updates => updateTemplate.mutate(updates)}
        saving={updateTemplate.isPending}
      />

      <ConfirmArchiveDialog
        open={!!archiveId}
        onOpenChange={open => { if (!open) setArchiveId(null); }}
        onConfirm={() => { if (archiveId) archiveTemplate.mutate(archiveId); setArchiveId(null); }}
      />

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        onConfirm={() => { if (deleteId) deleteTemplate.mutate(deleteId); setDeleteId(null); }}
      />

      <PromptVersionCompareDialog
        open={!!compareVersions[0] && !!compareVersions[1]}
        onOpenChange={open => { if (!open) setCompareVersions([null, null]); }}
        versionA={compareVersions[0]}
        versionB={compareVersions[1]}
      />
    </div>
  );
}
