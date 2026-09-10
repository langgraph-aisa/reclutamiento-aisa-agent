import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import Account from "./pages/Account";
import AgentEvaluator from "./pages/AgentEvaluator";
import Apply from "./pages/Apply";
import Candidates from "./pages/Candidates";
import Config from "./pages/Config";
import FormBuilder from "./pages/FormBuilder";
import Home from "./pages/Home";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import MstEir from "./pages/MstEir";
import Profiles from "./pages/Profiles";
import Reports from "./pages/Reports";
import Users from "./pages/Users";

const HumanReview = lazy(() => import("./pages/HumanReview"));
const PrivacyTerms = lazy(() => import("./pages/PrivacyTerms"));

function AdminShell({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/apply/:token" component={Apply} />
      <Route path="/privacidad-terminos">
        <Suspense
          fallback={
            <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
              Cargando documento…
            </div>
          }
        >
          <PrivacyTerms />
        </Suspense>
      </Route>
      <Route path="/admin/account">
        <AdminShell>
          <Account />
        </AdminShell>
      </Route>
      <Route path="/admin">
        <AdminShell>
          <Home />
        </AdminShell>
      </Route>
      <Route path="/admin/jobs">
        <AdminShell>
          <Jobs />
        </AdminShell>
      </Route>
      <Route path="/admin/profiles">
        <AdminShell>
          <Profiles />
        </AdminShell>
      </Route>
      <Route path="/admin/users">
        <AdminShell>
          <Users />
        </AdminShell>
      </Route>
      <Route path="/admin/candidates">
        <AdminShell>
          <Candidates />
        </AdminShell>
      </Route>
      <Route path="/admin/human-review">
        <AdminShell>
          <Suspense
            fallback={
              <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
                Preparando espacio de revisión…
              </div>
            }
          >
            <HumanReview />
          </Suspense>
        </AdminShell>
      </Route>
      <Route path="/admin/reports">
        <AdminShell>
          <Reports />
        </AdminShell>
      </Route>
      <Route path="/admin/mst-eir">
        <AdminShell>
          <MstEir />
        </AdminShell>
      </Route>
      <Route path="/admin/agent-evaluator">
        <AdminShell>
          <AgentEvaluator />
        </AdminShell>
      </Route>
      <Route path="/admin/config">
        <AdminShell>
          <Config />
        </AdminShell>
      </Route>
      <Route path="/admin/forms/:positionId">
        <AdminShell>
          <FormBuilder />
        </AdminShell>
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
