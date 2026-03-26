import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useCategorySchemas, useCreateCategorySchema, useUpdateCategorySchema, useDeleteCategorySchema } from "@/hooks/useValidation";
import { useCategoryTree } from "@/hooks/useCategories";
import { toast } from "sonner";

export function SchemaEditor() {
  const { data: schemas, isLoading } = useCategorySchemas();
  const { flat: categories } = useCategoryTree();
  const createSchema = useCreateCategorySchema();
  const updateSchema = useUpdateCategorySchema();
  const deleteSchema = useDeleteCategorySchema();

  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    category_id: "",
    required_fields: "optimized_title, optimized_description, meta_title, meta_description, seo_slug",
    optional_fields: "optimized_short_description, tags, faq, image_urls, technical_specs",
    variation_attributes: "color, size, capacity, voltage",
    schema_definition: "{}",
  });

  const resetForm = () => {
    setForm({
      name: "",
      category_id: "",
      required_fields: "optimized_title, optimized_description, meta_title, meta_description, seo_slug",
      optional_fields: "optimized_short_description, tags, faq, image_urls, technical_specs",
      variation_attributes: "color, size, capacity, voltage",
      schema_definition: "{}",
    });
  };

  const handleCreate = () => {
    let schemaDef = {};
    try { schemaDef = JSON.parse(form.schema_definition); } catch { toast.error("JSON inválido"); return; }

    createSchema.mutate({
      name: form.name,
      category_id: form.category_id || null,
      required_fields: form.required_fields.split(",").map(s => s.trim()).filter(Boolean),
      optional_fields: form.optional_fields.split(",").map(s => s.trim()).filter(Boolean),
      variation_attributes: form.variation_attributes.split(",").map(s => s.trim()).filter(Boolean),
      schema_definition: schemaDef,
    });
    setShowCreate(false);
    resetForm();
  };

  const handleEdit = (schema: any) => {
    setEditId(schema.id);
    setForm({
      name: schema.name,
      category_id: schema.category_id || "",
      required_fields: (schema.required_fields || []).join(", "),
      optional_fields: (schema.optional_fields || []).join(", "),
      variation_attributes: Array.isArray(schema.variation_attributes) 
        ? schema.variation_attributes.map((v: any) => typeof v === "string" ? v : JSON.stringify(v)).join(", ")
        : "",
      schema_definition: JSON.stringify(schema.schema_definition || {}, null, 2),
    });
  };

  const handleUpdate = () => {
    if (!editId) return;
    let schemaDef = {};
    try { schemaDef = JSON.parse(form.schema_definition); } catch { toast.error("JSON inválido"); return; }

    updateSchema.mutate({
      id: editId,
      updates: {
        name: form.name,
        category_id: form.category_id || null,
        required_fields: form.required_fields.split(",").map(s => s.trim()).filter(Boolean),
        optional_fields: form.optional_fields.split(",").map(s => s.trim()).filter(Boolean),
        variation_attributes: form.variation_attributes.split(",").map(s => s.trim()).filter(Boolean),
        schema_definition: schemaDef,
      },
    });
    setEditId(null);
    resetForm();
  };

  const SchemaForm = ({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel: string }) => (
    <div className="space-y-3">
      <div><Label className="text-xs">Nome</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Schema Geral" /></div>
      <div>
        <Label className="text-xs">Categoria (vazio = global)</Label>
        <Select value={form.category_id} onValueChange={v => setForm(f => ({ ...f, category_id: v === "global" ? "" : v }))}>
          <SelectTrigger><SelectValue placeholder="Global (todas)" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Global (todas)</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div><Label className="text-xs">Campos obrigatórios (separados por vírgula)</Label><Input value={form.required_fields} onChange={e => setForm(f => ({ ...f, required_fields: e.target.value }))} /></div>
      <div><Label className="text-xs">Campos opcionais</Label><Input value={form.optional_fields} onChange={e => setForm(f => ({ ...f, optional_fields: e.target.value }))} /></div>
      <div><Label className="text-xs">Atributos de variação</Label><Input value={form.variation_attributes} onChange={e => setForm(f => ({ ...f, variation_attributes: e.target.value }))} /></div>
      <div><Label className="text-xs">Schema Definition (JSON)</Label><Textarea value={form.schema_definition} onChange={e => setForm(f => ({ ...f, schema_definition: e.target.value }))} className="font-mono text-xs min-h-[100px]" /></div>
      <DialogFooter><Button onClick={onSubmit} disabled={!form.name.trim()}>{submitLabel}</Button></DialogFooter>
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Schemas de Categoria</CardTitle>
            <Button size="sm" variant="outline" onClick={() => { resetForm(); setShowCreate(true); }}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Novo Schema
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground">A carregar...</p>}
          {schemas?.map(schema => (
            <div key={schema.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{schema.name}</span>
                  <Badge variant={schema.is_active ? "default" : "secondary"} className="text-[10px]">
                    {schema.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                  {!schema.category_id && <Badge variant="outline" className="text-[10px]">Global</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(schema.required_fields as string[])?.length || 0} obrigatórios · {(schema.optional_fields as string[])?.length || 0} opcionais
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(schema)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => {
                  if (confirm("Eliminar este schema?")) deleteSchema.mutate(schema.id);
                }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                <Switch
                  checked={schema.is_active ?? true}
                  onCheckedChange={checked => updateSchema.mutate({ id: schema.id, updates: { is_active: checked } })}
                />
              </div>
            </div>
          ))}
          {!isLoading && (!schemas || schemas.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-4">Nenhum schema definido. Crie o primeiro schema para configurar a validação por categoria.</p>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Schema</DialogTitle></DialogHeader>
          <SchemaForm onSubmit={handleCreate} submitLabel="Criar" />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editId} onOpenChange={open => !open && setEditId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Schema</DialogTitle></DialogHeader>
          <SchemaForm onSubmit={handleUpdate} submitLabel="Guardar" />
        </DialogContent>
      </Dialog>
    </>
  );
}
