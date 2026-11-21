export interface User {
  id: number;
  username: string;
  email: string;
  role: 'guest' | 'user' | 'pro' | 'admin';
  avatar_url: string;
  bio: string;
  public_profile: boolean;
  storage_quota_bytes: number;
  storage_used_bytes: number;
  default_engine: 'smart' | 'local' | 'r2';
  totp_enabled: boolean;
  status: 'active' | 'banned';
  last_login_at?: string;
  created_at: string;
}

export interface RolePolicy {
  role: string;
  display_name: string;
  storage_quota_bytes: number;
  max_file_size_bytes: number;
  allowed_mimes: string[];
  rate_limit_per_min: number;
  monthly_upload_limit?: number;
  allowed_engines: string[];
  default_engine: string;
  require_moderation: boolean;
  allow_api_token: boolean;
  allow_custom_watermark: boolean;
}

export interface Asset {
  id: number;
  short_code: string;
  user_id?: number;
  username?: string;
  object_id: number;
  album_id?: number | null;
  album_title?: string;
  original_name: string;
  tags: string[];
  visibility: 'public' | 'unlisted' | 'private' | 'password';
  has_password: boolean;
  view_count: number;
  is_favorite?: boolean;
  like_count?: number;
  expires_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  sha256: string;
  storage_engine: 'local' | 'r2';
  object_key: string;
  mime_type: string;
  size_bytes: number;
  width: number;
  height: number;
  dominant_color: string;
  color_palette: string[];
  thumbhash?: string;
  exif_data?: Record<string, unknown>;
  ref_count: number;
  moderation_status: 'pending' | 'passed' | 'blocked';
  direct_url: string;
  thumb_url: string;
  webp_url: string;
  avif_url: string;
  watermark_url?: string;
  share_url: string;
}

export interface Album {
  id: number;
  user_id: number;
  parent_id?: number | null;
  slug: string;
  title: string;
  description: string;
  visibility: 'public' | 'unlisted' | 'private' | 'password';
  has_password: boolean;
  cover_short_code: string;
  cover_url: string;
  asset_count: number;
  created_at: string;
}

export interface WatermarkPreset {
  id: number;
  name: string;
  mode: 'text' | 'image';
  text_content: string;
  image_url?: string;
  font_size: number;
  text_color: string;
  opacity: number;
  position: string;
  offset_x: number;
  offset_y: number;
  scale: number;
  angle: number;
  tiled: boolean;
  is_default: boolean;
}

export interface APIToken {
  id: number;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

export interface InviteCode {
  id: number;
  code: string;
  role: string;
  max_uses: number;
  used_count: number;
  expires_at?: string;
  created_at: string;
}

export interface AuditLog {
  id: number;
  username: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: Record<string, unknown>;
  ip_address: string;
  created_at: string;
}
