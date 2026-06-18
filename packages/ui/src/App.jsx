import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout }              from './components/Layout.jsx';
import { Home }                from './pages/Home.jsx';
import { ScanProgress }        from './pages/ScanProgress.jsx';
import { ScanReport }          from './pages/ScanReport.jsx';
import { SiteProgress }        from './pages/SiteProgress.jsx';
import { SiteReport }          from './pages/SiteReport.jsx';
import { LandingPage }         from './pages/LandingPage.jsx';
import { AdminLayout }         from './pages/admin/AdminLayout.jsx';
import { AdminLogin }          from './pages/admin/AdminLogin.jsx';
import { AdminForgotPassword } from './pages/admin/AdminForgotPassword.jsx';
import { AdminVerifyOtp }      from './pages/admin/AdminVerifyOtp.jsx';
import { AdminResetPassword }  from './pages/admin/AdminResetPassword.jsx';

export function App() {
  return (
    <Routes>
      {/* Landing page — role selection */}
      <Route path="/" element={<LandingPage />} />

      {/* Admin auth pages — public, no session required */}
      <Route path="/admin/login"            element={<AdminLogin />} />
      <Route path="/admin/forgot-password"  element={<AdminForgotPassword />} />
      <Route path="/admin/verify-otp"       element={<AdminVerifyOtp />} />
      <Route path="/admin/reset-password"   element={<AdminResetPassword />} />

      {/* Admin area — session check is inside AdminLayout */}
      <Route path="/admin/*" element={<AdminLayout />} />

      {/* Main tool — wrapped in the existing Layout, accessible without login */}
      <Route path="*" element={
        <Layout>
          <Routes>
            <Route path="/tool"                    element={<Home />} />
            <Route path="/scan/:scanId"            element={<ScanProgress />} />
            <Route path="/scan/:scanId/report"     element={<ScanReport />} />
            <Route path="/site/:siteId"            element={<SiteProgress />} />
            <Route path="/site/:siteId/report"     element={<SiteReport />} />
            <Route path="*"                        element={<Navigate to="/tool" replace />} />
          </Routes>
        </Layout>
      } />
    </Routes>
  );
}
