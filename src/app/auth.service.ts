import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../environments/environment';

export interface AuthUser {
  userId: number;
  contractId: number;
  username: string;
  name?: string | null;
  email?: string | null;
}

interface AuthSession {
  token: string;
  user: AuthUser;
}

interface AuthResponse {
  data: AuthSession;
}

interface ContractResponse {
  data: {
    joinCode: string;
  };
}

export interface UserProfile {
  id: number;
  contractId: number;
  username: string;
  email: string | null;
  name: string | null;
  hasPassword: boolean;
}

interface UserProfileResponse {
  data: {
    user: UserProfile;
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly sessionStorageKey = 'financeAuthSession';

  get token(): string {
    return this.getSession()?.token ?? '';
  }

  get user(): AuthUser | null {
    return this.getSession()?.user ?? null;
  }

  get isAuthenticated(): boolean {
    return !!this.token;
  }

  signIn(username: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiBaseUrl}/auth/login`, { username, password })
      .pipe(tap(({ data }) => this.storeSession(data)));
  }

  register(email: string, username: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiBaseUrl}/auth/register`, { email, username, password, joinCode: '' })
      .pipe(tap(({ data }) => this.storeSession(data)));
  }

  signInWithGoogle(credential: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiBaseUrl}/auth/google`, { credential })
      .pipe(tap(({ data }) => this.storeSession(data)));
  }

  getContractJoinCode(): Observable<ContractResponse> {
    return this.http.get<ContractResponse>(`${this.apiBaseUrl}/auth/contract`);
  }

  getProfile(): Observable<UserProfileResponse> {
    return this.http.get<UserProfileResponse>(`${this.apiBaseUrl}/auth/me`);
  }

  updateProfile(payload: { name: string; username: string; email: string }): Observable<UserProfileResponse> {
    return this.http
      .post<UserProfileResponse>(`${this.apiBaseUrl}/auth/me`, payload)
      .pipe(tap(({ data }) => this.patchSessionUser(data.user)));
  }

  changePassword(payload: { currentPassword: string; newPassword: string }): Observable<unknown> {
    return this.http.post(`${this.apiBaseUrl}/auth/password`, payload);
  }

  logout(): void {
    localStorage.removeItem(this.sessionStorageKey);
    void this.router.navigate(['/login']);
  }

  private storeSession(session: AuthSession): void {
    localStorage.setItem(this.sessionStorageKey, JSON.stringify(session));
  }

  private patchSessionUser(profile: UserProfile): void {
    const session = this.getSession();

    if (!session) {
      return;
    }

    this.storeSession({
      ...session,
      user: {
        ...session.user,
        username: profile.username,
        name: profile.name,
        email: profile.email,
      },
    });
  }

  private getSession(): AuthSession | null {
    const value = localStorage.getItem(this.sessionStorageKey);

    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as AuthSession;
    } catch {
      localStorage.removeItem(this.sessionStorageKey);
      return null;
    }
  }
}
