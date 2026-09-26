import { describe, it, expect } from 'vitest';
import { inferLayerFromPath, getLayerColor, LAYER_COLORS } from '../../src/shared/layerUtils.ts';

describe('inferLayerFromPath', () => {
  it('should detect controller layer', () => {
    expect(inferLayerFromPath('src/controller/UserController.ts')).toBe('controller');
    expect(inferLayerFromPath('src/controllers/auth.ts')).toBe('controller');
    expect(inferLayerFromPath('src/api/routes.ts')).toBe('controller');
    expect(inferLayerFromPath('src/endpoints/handler.ts')).toBe('controller');
    expect(inferLayerFromPath('src/handlers/request.ts')).toBe('controller');
  });

  it('should detect service layer', () => {
    expect(inferLayerFromPath('src/service/UserService.ts')).toBe('service');
    expect(inferLayerFromPath('src/services/auth.ts')).toBe('service');
    expect(inferLayerFromPath('src/business/logic.ts')).toBe('service');
    expect(inferLayerFromPath('src/domain/model.ts')).toBe('service');
    expect(inferLayerFromPath('src/usecase/auth.ts')).toBe('service');
    expect(inferLayerFromPath('src/usecases/login.ts')).toBe('service');
  });

  it('should detect data layer', () => {
    expect(inferLayerFromPath('src/model/User.ts')).toBe('data');
    expect(inferLayerFromPath('src/models/User.ts')).toBe('data');
    expect(inferLayerFromPath('src/entity/Account.ts')).toBe('data');
    expect(inferLayerFromPath('src/entities/Order.ts')).toBe('data');
    expect(inferLayerFromPath('src/repository/UserRepo.ts')).toBe('data');
    expect(inferLayerFromPath('src/repositories/UserRepo.ts')).toBe('data');
    expect(inferLayerFromPath('src/dao/UserDAO.ts')).toBe('data');
    expect(inferLayerFromPath('src/data/store.ts')).toBe('data');
    expect(inferLayerFromPath('src/stores/cache.ts')).toBe('data');
  });

  it('should detect presentation layer', () => {
    expect(inferLayerFromPath('src/view/Home.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/views/Dashboard.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/component/Button.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/components/Header.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/ui/Widget.ts')).toBe('presentation');
    expect(inferLayerFromPath('src/page/Login.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/pages/Home.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/screen/Main.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/screens/Settings.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/template/Layout.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/templates/Default.tsx')).toBe('presentation');
    expect(inferLayerFromPath('src/widget/Nav.ts')).toBe('presentation');
    expect(inferLayerFromPath('src/widgets/Sidebar.ts')).toBe('presentation');
  });

  it('should detect utility layer', () => {
    expect(inferLayerFromPath('src/util/format.ts')).toBe('utility');
    expect(inferLayerFromPath('src/utils/helpers.ts')).toBe('utility');
    expect(inferLayerFromPath('src/helper/math.ts')).toBe('utility');
    expect(inferLayerFromPath('src/helpers/string.ts')).toBe('utility');
    expect(inferLayerFromPath('src/common/types.ts')).toBe('utility');
    expect(inferLayerFromPath('src/shared/constants.ts')).toBe('utility');
    expect(inferLayerFromPath('src/lib/crypto.ts')).toBe('utility');
    expect(inferLayerFromPath('src/libs/parser.ts')).toBe('utility');
  });

  it('should detect config layer', () => {
    expect(inferLayerFromPath('src/config/app.ts')).toBe('config');
    expect(inferLayerFromPath('src/configs/env.ts')).toBe('config');
    expect(inferLayerFromPath('src/conf/settings.ts')).toBe('config');
    expect(inferLayerFromPath('src/settings/prod.ts')).toBe('config');
  });

  it('should detect test layer', () => {
    expect(inferLayerFromPath('src/test/spec.ts')).toBe('test');
    expect(inferLayerFromPath('src/tests/unit.ts')).toBe('test');
    expect(inferLayerFromPath('src/spec/feature.ts')).toBe('test');
    expect(inferLayerFromPath('src/specs/api.ts')).toBe('test');
    expect(inferLayerFromPath('src/__tests__/foo.ts')).toBe('test');
  });

  it('should detect middleware layer', () => {
    expect(inferLayerFromPath('src/middleware/auth.ts')).toBe('middleware');
    expect(inferLayerFromPath('src/middlewares/cors.ts')).toBe('middleware');
    expect(inferLayerFromPath('src/interceptor/log.ts')).toBe('middleware');
    expect(inferLayerFromPath('src/interceptors/cache.ts')).toBe('middleware');
    expect(inferLayerFromPath('src/filter/security.ts')).toBe('middleware');
    expect(inferLayerFromPath('src/filters/rate.ts')).toBe('middleware');
  });

  it('should detect adapter layer', () => {
    expect(inferLayerFromPath('src/adapter/legacy.ts')).toBe('adapter');
    expect(inferLayerFromPath('src/adapters/external.ts')).toBe('adapter');
    expect(inferLayerFromPath('src/gateway/payment.ts')).toBe('adapter');
    expect(inferLayerFromPath('src/gateways/api.ts')).toBe('adapter');
  });

  it('should detect extension layer', () => {
    expect(inferLayerFromPath('src/hook/useAuth.ts')).toBe('extension');
    expect(inferLayerFromPath('src/hooks/useFetch.ts')).toBe('extension');
    expect(inferLayerFromPath('src/plugin/seo.ts')).toBe('extension');
    expect(inferLayerFromPath('src/plugins/analytics.ts')).toBe('extension');
  });

  it('should detect type layer', () => {
    expect(inferLayerFromPath('src/types/index.ts')).toBe('type');
    expect(inferLayerFromPath('src/interface/User.ts')).toBe('type');
    expect(inferLayerFromPath('src/interfaces/IUser.ts')).toBe('type');
    expect(inferLayerFromPath('src/typedef/result.ts')).toBe('type');
    expect(inferLayerFromPath('src/typedefs/common.ts')).toBe('type');
  });

  it('should detect asset layer', () => {
    expect(inferLayerFromPath('src/style/main.css')).toBe('asset');
    expect(inferLayerFromPath('src/styles/theme.css')).toBe('asset');
    expect(inferLayerFromPath('src/css/reset.css')).toBe('asset');
    expect(inferLayerFromPath('src/asset/logo.png')).toBe('asset');
    expect(inferLayerFromPath('src/assets/icon.svg')).toBe('asset');
    expect(inferLayerFromPath('src/static/font.woff')).toBe('asset');
    expect(inferLayerFromPath('src/public/robots.txt')).toBe('asset');
  });

  it('should detect security layer', () => {
    expect(inferLayerFromPath('src/auth/login.ts')).toBe('security');
    expect(inferLayerFromPath('src/security/policy.ts')).toBe('security');
    expect(inferLayerFromPath('src/permission/role.ts')).toBe('security');
    expect(inferLayerFromPath('src/permissions/acl.ts')).toBe('security');
  });

  it('should detect database layer', () => {
    expect(inferLayerFromPath('src/db/connection.ts')).toBe('database');
    expect(inferLayerFromPath('src/database/schema.ts')).toBe('database');
    expect(inferLayerFromPath('src/migration/001_init.ts')).toBe('database');
    expect(inferLayerFromPath('src/migrations/002_users.ts')).toBe('database');
    expect(inferLayerFromPath('src/schema/types.ts')).toBe('database');
    expect(inferLayerFromPath('src/schemas/validation.ts')).toBe('database');
  });

  it('should fall back to top-level directory name for unrecognized paths', () => {
    expect(inferLayerFromPath('src/unknown/module.ts')).toBe('unknown');
    expect(inferLayerFromPath('app/custom/handler.ts')).toBe('custom');
    expect(inferLayerFromPath('lib/internal/util.ts')).toBe('internal');
  });

  it('should return core for single-segment paths', () => {
    expect(inferLayerFromPath('file.ts')).toBe('core');
    expect(inferLayerFromPath('module.ts')).toBe('core');
  });

  it('should return core for empty path', () => {
    expect(inferLayerFromPath('')).toBe('core');
  });

  it('should handle Windows-style paths with forward slashes', () => {
    // inferLayerFromPath uses forward-slash regex patterns for layer detection
    // Windows backslash paths fall through to segment-based fallback
    expect(inferLayerFromPath('src/controllers/auth.ts')).toBe('controller');
    expect(inferLayerFromPath('src/services/user.ts')).toBe('service');
  });

  it('should handle paths with src prefix by using second segment', () => {
    expect(inferLayerFromPath('src/customdir/file.ts')).toBe('customdir');
    expect(inferLayerFromPath('app/customdir/file.ts')).toBe('customdir');
    expect(inferLayerFromPath('lib/customdir/file.ts')).toBe('customdir');
  });
});

describe('getLayerColor', () => {
  it('should return dark color for known layer when isDark is true', () => {
    expect(getLayerColor('controller', true)).toBe('#60a5fa');
    expect(getLayerColor('service', true)).toBe('#10b981');
    expect(getLayerColor('data', true)).toBe('#f59e0b');
    expect(getLayerColor('presentation', true)).toBe('#ec4899');
    expect(getLayerColor('utility', true)).toBe('#818cf8');
    expect(getLayerColor('config', true)).toBe('#a78bfa');
    expect(getLayerColor('test', true)).toBe('#34d399');
    expect(getLayerColor('middleware', true)).toBe('#fbbf24');
    expect(getLayerColor('adapter', true)).toBe('#22d3ee');
    expect(getLayerColor('extension', true)).toBe('#f472b6');
    expect(getLayerColor('type', true)).toBe('#a78bfa');
    expect(getLayerColor('asset', true)).toBe('#fb7185');
    expect(getLayerColor('security', true)).toBe('#ef4444');
    expect(getLayerColor('database', true)).toBe('#84cc16');
    expect(getLayerColor('core', true)).toBe('#6366f1');
  });

  it('should return light color for known layer when isDark is false', () => {
    expect(getLayerColor('controller', false)).toBe('#3b82f6');
    expect(getLayerColor('service', false)).toBe('#059669');
    expect(getLayerColor('data', false)).toBe('#d97706');
    expect(getLayerColor('presentation', false)).toBe('#db2777');
    expect(getLayerColor('utility', false)).toBe('#6366f1');
    expect(getLayerColor('config', false)).toBe('#7c3aed');
    expect(getLayerColor('test', false)).toBe('#14b8a6');
    expect(getLayerColor('middleware', false)).toBe('#eab308');
    expect(getLayerColor('adapter', false)).toBe('#06b6d4');
    expect(getLayerColor('extension', false)).toBe('#ec4899');
    expect(getLayerColor('type', false)).toBe('#7c3aed');
    expect(getLayerColor('asset', false)).toBe('#f43f5e');
    expect(getLayerColor('security', false)).toBe('#dc2626');
    expect(getLayerColor('database', false)).toBe('#65a30d');
    expect(getLayerColor('core', false)).toBe('#4f46e5');
  });

  it('should return fallback color for unknown layer', () => {
    const color = getLayerColor('unknownlayer', true);
    // Fallback is determined by charCodeAt(0) % LAYER_COLORS length
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('should return fallback color for unknown layer in light mode', () => {
    const color = getLayerColor('unknownlayer', false);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('should return consistent fallback for same unknown layer', () => {
    const dark1 = getLayerColor('xyz', true);
    const dark2 = getLayerColor('xyz', true);
    expect(dark1).toBe(dark2);
  });

  it('should return different fallback colors for different unknown layers', () => {
    const color1 = getLayerColor('aaa', true);
    const color2 = getLayerColor('zzz', true);
    // Different first characters should produce different indices
    expect(color1).not.toBe(color2);
  });
});

describe('LAYER_COLORS', () => {
  it('should have entries for all standard layers', () => {
    const expectedLayers = [
      'controller', 'service', 'data', 'presentation', 'utility',
      'config', 'test', 'middleware', 'adapter', 'extension',
      'type', 'asset', 'security', 'database', 'core',
    ];
    for (const layer of expectedLayers) {
      expect(LAYER_COLORS[layer]).toBeDefined();
      expect(LAYER_COLORS[layer]!.dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(LAYER_COLORS[layer]!.light).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('should have dark and light variants for each layer', () => {
    for (const key of Object.keys(LAYER_COLORS)) {
      expect(LAYER_COLORS[key]!.dark).toBeDefined();
      expect(LAYER_COLORS[key]!.light).toBeDefined();
      expect(LAYER_COLORS[key]!.dark).not.toBe(LAYER_COLORS[key]!.light);
    }
  });
});