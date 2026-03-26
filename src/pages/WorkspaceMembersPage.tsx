import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, UserPlus, Users, Clock, XCircle, Shield, Wifi, WifiOff } from "lucide-react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useWorkspaceMembers,
  useWorkspaceInvitations,
  useCurrentMemberRole,
  useManageMember,
  hasMinRole,
  type WorkspaceRole,
} from "@/hooks/useWorkspaceMembers";
import { MemberRoleBadge } from "@/components/MemberRoleBadge";
import { InviteMemberDialog } from "@/components/InviteMemberDialog";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";

const WorkspaceMembersPage = () => {
  const { activeWorkspace } = useWorkspaceContext();
  const { user } = useAuth();
  const wsId = activeWorkspace?.id;
  const { data: members = [], isLoading: membersLoading } = useWorkspaceMembers(wsId);
  const { data: invitations = [], isLoading: invLoading } = useWorkspaceInvitations(wsId);
  const { data: myRole } = useCurrentMemberRole(wsId);
  const manageMember = useManageMember();
  const [showInvite, setShowInvite] = useState(false);

  const canManage = hasMinRole(myRole, "admin");
  const isOwner = myRole === "owner";

  const activeMembers = members.filter((m) => m.status === "active");
  const pendingMembers = members.filter((m) => m.status === "pending");

  // Current user is "online" by definition
  const onlineCount = activeMembers.filter((m) => m.user_id === user?.id).length || 0;

  if (!activeWorkspace) {
    return (
      <div className="p-6 flex justify-center py-20">
        <p className="text-muted-foreground">Nenhum workspace selecionado.</p>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6" /> Membros do Workspace
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerir quem tem acesso a <strong>{activeWorkspace.name}</strong>.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus className="w-4 h-4 mr-2" /> Convidar
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{activeMembers.length}</p>
              <p className="text-xs text-muted-foreground">Membros Ativos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Clock className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{invitations.length + pendingMembers.length}</p>
              <p className="text-xs text-muted-foreground">Convites Pendentes</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <Wifi className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{onlineCount > 0 ? onlineCount : 1}</p>
              <p className="text-xs text-muted-foreground">Online Agora</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" /> Membros Ativos ({activeMembers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : activeMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum membro ativo encontrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Desde</TableHead>
                  {canManage && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeMembers.map((m) => {
                  const isMe = m.user_id === user?.id;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {isMe ? (
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground/30" />
                          )}
                          {m.email}
                          {isMe && (
                            <Badge variant="secondary" className="ml-1 text-xs">Tu</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage && m.role !== "owner" && !isMe ? (
                          <Select
                            value={m.role}
                            onValueChange={(role) =>
                              manageMember.mutate({
                                action: "update-role",
                                workspaceId: wsId!,
                                memberId: m.id,
                                role,
                              })
                            }
                          >
                            <SelectTrigger className="w-28 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {isOwner && <SelectItem value="owner">Owner</SelectItem>}
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="editor">Editor</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <MemberRoleBadge role={m.role} />
                        )}
                      </TableCell>
                      <TableCell>
                        {isMe ? (
                          <Badge variant="outline" className="text-green-600 border-green-300 text-xs">
                            <Wifi className="w-3 h-3 mr-1" /> Online
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-xs">
                            <WifiOff className="w-3 h-3 mr-1" /> Offline
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(m.accepted_at || m.created_at).toLocaleDateString("pt-PT")}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          {isOwner && m.role !== "owner" && !isMe && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() =>
                                manageMember.mutate({
                                  action: "remove-member",
                                  workspaceId: wsId!,
                                  memberId: m.id,
                                })
                              }
                              disabled={manageMember.isPending}
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      {(invitations.length > 0 || pendingMembers.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Convites Pendentes ({invitations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expira</TableHead>
                    {canManage && <TableHead className="text-right">Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell>
                        <MemberRoleBadge role={inv.role as WorkspaceRole} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(inv.expires_at).toLocaleDateString("pt-PT")}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              manageMember.mutate({
                                action: "revoke-invitation",
                                workspaceId: wsId!,
                                invitationId: inv.id,
                              })
                            }
                            disabled={manageMember.isPending}
                          >
                            Revogar
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {wsId && <InviteMemberDialog open={showInvite} onOpenChange={setShowInvite} workspaceId={wsId} />}
    </div>
  );
};

export default WorkspaceMembersPage;
