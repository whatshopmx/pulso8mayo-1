import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api/error';
import * as branchScopeModule from '@/lib/branch-scope';

const mocks = vi.hoisted(() => ({
  registerRecoveryProposal: vi.fn(),
  getRecoveryProposalForReview: vi.fn(),
  authUser: {
    id: 'user-admin-1',
    role: 'ADMIN',
    companyId: '10000000-0000-4000-8000-000000000001',
    branchId: null as string | null,
    email: 'admin@pulso.test',
  },
}));

vi.mock('@/lib/services/sale-recovery-proposals', () => ({
  registerRecoveryProposal: mocks.registerRecoveryProposal,
}));

vi.mock('@/lib/services/sale-recovery-decision', () => ({
  getRecoveryProposalForReview: mocks.getRecoveryProposalForReview,
}));

vi.mock('@/lib/api/with-auth', () => ({
  withTenantAuth: (handler: (req: Request, ctx: { auth: { user: typeof mocks.authUser; tenantId: string; branchId: string | null } }) => Promise<Response>) =>
    async (req: Request) => {
      if (!mocks.authUser.id) {
        return new Response(JSON.stringify({ error: 'No session found. Please sign in.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      try {
        return await handler(req, {
          auth: {
            user: mocks.authUser,
            tenantId: mocks.authUser.companyId,
            branchId: mocks.authUser.branchId,
          },
        });
      } catch (error) {
        if (error instanceof ApiError) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: error.statusCode,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    },
}));

import { GET, POST } from '@/app/api/inventory/sales-entry/recovery-proposals/route';

const branchId = '20000000-0000-4000-8000-000000000002';
const proposalId = '30000000-0000-4000-8000-000000000003';
const legacySaleId = '40000000-0000-4000-8000-000000000004';
const idempotencyKey = '50000000-0000-4000-8000-000000000005';
const saleAttestationId = '60000000-0000-4000-8000-000000000006';
const recipeAttestationId = '70000000-0000-4000-8000-000000000007';
const absenceAttestationId = '80000000-0000-4000-8000-000000000008';

const validBody = {
  branchId,
  legacySaleId,
  idempotencyKey,
  reason: 'Expediente preparado para recuperación histórica auditada',
  saleAttestationId,
  recipeAttestationId,
  absenceAttestationId,
};

describe('POST /api/inventory/sales-entry/recovery-proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUser = {
      id: 'user-admin-1',
      role: 'ADMIN',
      companyId: '10000000-0000-4000-8000-000000000001',
      branchId: null,
      email: 'admin@pulso.test',
    };
  });

  it('retorna 401 si no hay sesión autenticada', async () => {
    mocks.authUser = { id: '', role: 'ADMIN', companyId: '', branchId: null, email: '' };
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('retorna 403 si el rol no es administrativo (ej. EMPLEADO)', async () => {
    mocks.authUser.role = 'EMPLEADO';
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('autoridad administrativa');
  });

  it('retorna 403 si la sucursal del body está fuera del alcance del usuario', async () => {
    vi.spyOn(branchScopeModule, 'resolveBranchScope').mockReturnValueOnce({ kind: 'NONE' });
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('fuera del alcance');
  });

  it('retorna 400 si el Content-Type no es application/json', async () => {
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'invalid plain text',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Se requiere contenido JSON');
  });

  it('retorna 400 si el JSON es inválido o no es un objeto', async () => {
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('debe ser un objeto JSON');
  });

  it('retorna 413 si la solicitud excede 16 KiB', async () => {
    const bigString = 'x'.repeat(17000);
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '17050' },
      body: JSON.stringify({ ...validBody, large: bigString }),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it('retorna 400 si falta branchId en el cuerpo', async () => {
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, branchId: '' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Se requiere branchId');
  });

  it('retorna 503 si el almacenamiento privado R2 no está disponible', async () => {
    mocks.registerRecoveryProposal.mockRejectedValueOnce(
      new ApiError('Almacenamiento privado no disponible', 503)
    );
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Almacenamiento privado no disponible');
  });

  it('retorna 409 si el servicio detecta conflicto en fuentes o proyecciones', async () => {
    mocks.registerRecoveryProposal.mockRejectedValueOnce(
      ApiError.conflict('Las tres fuentes no describen la misma venta y cobertura')
    );
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Las tres fuentes no describen la misma venta');
  });

  it('retorna 201 al crear exitosamente un nuevo expediente de propuesta', async () => {
    mocks.registerRecoveryProposal.mockResolvedValueOnce({
      id: proposalId,
      created: true,
      proposalHash: 'hash-proposal-1',
      stateHash: 'hash-state-1',
      demand: [{ itemId: 'item-1', quantity: '1.0000', unit: 'KG' }],
    });
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.id).toBe(proposalId);
    expect(json.data.created).toBe(true);
    expect(mocks.registerRecoveryProposal).toHaveBeenCalledWith(validBody);
  });

  it('retorna 200 en reintento idempotente existente', async () => {
    mocks.registerRecoveryProposal.mockResolvedValueOnce({
      id: proposalId,
      created: false,
      proposalHash: 'hash-proposal-1',
      stateHash: 'hash-state-1',
      demand: [{ itemId: 'item-1', quantity: '1.0000', unit: 'KG' }],
    });
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(proposalId);
    expect(json.data.created).toBe(false);
  });
});

describe('GET /api/inventory/sales-entry/recovery-proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUser = {
      id: 'user-admin-1',
      role: 'ADMIN',
      companyId: '10000000-0000-4000-8000-000000000001',
      branchId: null,
      email: 'admin@pulso.test',
    };
  });

  it('retorna 400 si faltan branchId o proposalId', async () => {
    const req = new NextRequest('http://localhost/api/inventory/sales-entry/recovery-proposals?branchId=123');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('retorna 400 si contiene parámetros no permitidos', async () => {
    const req = new NextRequest(
      `http://localhost/api/inventory/sales-entry/recovery-proposals?branchId=${branchId}&proposalId=${proposalId}&extra=true`
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('retorna 403 si la sucursal está fuera del alcance del usuario', async () => {
    vi.spyOn(branchScopeModule, 'resolveBranchScope').mockReturnValueOnce({ kind: 'NONE' });
    const req = new NextRequest(
      `http://localhost/api/inventory/sales-entry/recovery-proposals?branchId=${branchId}&proposalId=${proposalId}`
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('fuera del alcance');
  });

  it('retorna 200 y el expediente para revisión con headers Cache-Control', async () => {
    const mockProposalData = {
      proposal: {
        id: proposalId,
        branchId,
        legacySaleId,
        requestedBy: 'user-admin-1',
        reason: 'Recuperación auditada',
        proposalHash: 'hash-p',
        stateHash: 'hash-s',
        demand: [{ itemId: 'item-1', quantity: '1.0000', unit: 'KG' }],
      },
      decision: null,
      canDecide: false,
    };
    mocks.getRecoveryProposalForReview.mockResolvedValueOnce(mockProposalData);

    const req = new NextRequest(
      `http://localhost/api/inventory/sales-entry/recovery-proposals?branchId=${branchId}&proposalId=${proposalId}`
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const json = await res.json();
    expect(json.data.proposal.id).toBe(proposalId);
    expect(mocks.getRecoveryProposalForReview).toHaveBeenCalledWith({ branchId, proposalId });
  });
});
