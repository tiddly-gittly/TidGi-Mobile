/**
 * CloudNodeRegistry: Cloud API integration for node discovery and registration
 */

import type { CloudNodeInfo, KeypairData } from './types';

export interface NodeStatusPayload {
  online: boolean;
  capabilities?: CloudNodeInfo['capabilities'];
}

export interface CloudAuthInfo {
  cloudUrl: string;
  jwt: string;
  email: string;
}

export class CloudNodeRegistry {
  private cloudAuth: CloudAuthInfo | null = null;

  setAuth(auth: CloudAuthInfo | null): void {
    this.cloudAuth = auth;
  }

  getAuth(): CloudAuthInfo | null {
    return this.cloudAuth;
  }

  async login(
    cloudUrl: string,
    email: string,
    password: string,
  ): Promise<{ ok: boolean; jwt?: string; error?: string }> {
    try {
      const response = await fetch(`${cloudUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as {
        accessToken?: string;
        error?: string;
      };
      if (data.accessToken) {
        this.cloudAuth = { cloudUrl, jwt: data.accessToken, email };
        return { ok: true, jwt: data.accessToken };
      }

      return { ok: false, error: data.error ?? 'Login failed' };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  logout(): void {
    this.cloudAuth = null;
  }

  async fetchNodeList(): Promise<CloudNodeInfo[]> {
    if (!this.cloudAuth) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await fetch(`${this.cloudAuth.cloudUrl}/api/nodes`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cloudAuth.jwt}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch nodes: ${response.status}`);
      }

      const data = (await response.json()) as { nodes: CloudNodeInfo[] };
      return data.nodes;
    } catch (error) {
      console.error('Failed to fetch node list:', error);
      return [];
    }
  }

  async requestNodeOtp(
    keypair: KeypairData,
  ): Promise<{ otp: string; expiresIn: number }> {
    if (!this.cloudAuth) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${this.cloudAuth.cloudUrl}/api/nodes/otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cloudAuth.jwt}`,
      },
      body: JSON.stringify({
        nodeId: keypair.nodeId,
        name: `Mobile-${keypair.nodeId.slice(0, 6)}`,
        x25519PublicKey: keypair.x25519PublicKey,
      }),
    });

    return response.json() as Promise<{ otp: string; expiresIn: number }>;
  }

  async registerNode(
    keypair: KeypairData,
    otp: string,
  ): Promise<{ nodeId: string }> {
    if (!this.cloudAuth) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(
      `${this.cloudAuth.cloudUrl}/api/nodes/register`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cloudAuth.jwt}`,
        },
        body: JSON.stringify({
          nodeId: keypair.nodeId,
          otp,
          x25519PublicKey: keypair.x25519PublicKey,
        }),
      },
    );

    return response.json() as Promise<{ nodeId: string }>;
  }

  async updateNodeStatus(
    nodeId: string,
    status: NodeStatusPayload,
  ): Promise<void> {
    if (!this.cloudAuth) {
      throw new Error('Not authenticated');
    }

    try {
      await fetch(`${this.cloudAuth.cloudUrl}/api/nodes/${nodeId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cloudAuth.jwt}`,
        },
        body: JSON.stringify(status),
      });
    } catch (error) {
      console.error('Failed to update node status:', error);
    }
  }
}
