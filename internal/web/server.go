// Package web expõe a API REST local, o fluxo SSE e a interface embutida.
package web

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"devpipe/internal/docs"
	"devpipe/internal/domain"
	"devpipe/internal/encx"
	"devpipe/internal/fazenda"
	"devpipe/internal/gitx"
	"devpipe/internal/pipeline"
	"devpipe/internal/provider"
	"devpipe/internal/rules"
	"devpipe/internal/security"
	"devpipe/internal/store"
)

//go:embed static
var staticFS embed.FS

const Version = "0.2.9"

type Server struct {
	st      *store.Store
	eng     *pipeline.Engine
	reg     *provider.Registry
	dataDir string
	port    int
	mu      sync.Mutex
}

func New(st *store.Store, eng *pipeline.Engine, reg *provider.Registry, dataDir string, port int) *Server {
	return &Server{st: st, eng: eng, reg: reg, dataDir: dataDir, port: port}
}

// ConfigureProviders (re)registra provedores a partir das configurações.
func ConfigureProviders(reg *provider.Registry, s domain.Settings) {
	gitx.CommitAuthorName, gitx.CommitAuthorEmail = s.CommitAuthorName, s.CommitAuthorEmail
	reg.Remove("claude")
	reg.Remove("generico")
	if s.Claude.Enabled {
		reg.Register(&provider.Claude{Binary: s.Claude.Binary, DefaultModel: s.Claude.Model, PermissionMode: s.Claude.PermissionMode,
			MaxBudgetUSD: s.Claude.MaxBudgetUSD, ExtraArgs: strings.Fields(s.Claude.ExtraArgs), SubscriptionOnly: s.Claude.SubscriptionOnly,
			AnalysisModel: s.Claude.AnalysisModel, Effort: s.Claude.Effort})
	}
	if s.Generic.Enabled && strings.TrimSpace(s.Generic.Command) != "" {
		reg.Register(&provider.Generic{DisplayName: s.Generic.Name, Command: s.Generic.Command})
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	h := func(pattern string, fn func(http.ResponseWriter, *http.Request) (any, error)) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			v, err := fn(w, r)
			if err != nil {
				code := http.StatusBadRequest
				if errors.Is(err, store.ErrNotFound) {
					code = http.StatusNotFound
				} else if errors.Is(err, pipeline.ErrBusy) {
					code = http.StatusConflict
				}
				writeJSON(w, code, map[string]string{"error": err.Error()})
				return
			}
			if v == nil {
				v = map[string]bool{"ok": true}
			}
			writeJSON(w, 200, v)
		})
	}

	h("GET /api/meta", s.meta)
	h("GET /api/stats", func(w http.ResponseWriter, r *http.Request) (any, error) { return s.st.Stats() })
	h("GET /api/fazenda", s.fazenda)

	h("GET /api/projects", func(w http.ResponseWriter, r *http.Request) (any, error) { return s.st.ListProjects() })
	h("POST /api/projects/inspect", s.inspectProject)
	h("POST /api/projects", s.saveProject)
	h("PUT /api/projects/{id}", s.saveProject)
	h("DELETE /api/projects/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, s.st.DeleteProject(pid(r)) })
	h("GET /api/projects/{id}/branches", s.projectBranches)

	h("GET /api/demands", s.listDemands)
	h("POST /api/demands", s.createDemand)
	h("GET /api/demands/{id}", s.getDemand)
	h("PUT /api/demands/{id}", s.updateDemand)
	h("DELETE /api/demands/{id}", s.deleteDemand)
	h("POST /api/demands/{id}/attachments", s.addAttachments)
	h("POST /api/demands/{id}/enqueue", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, s.eng.Enqueue(pid(r)) })
	h("POST /api/demands/{id}/cancel", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, s.eng.Cancel(pid(r)) })
	h("POST /api/demands/{id}/approve-spec", s.approveSpec)
	h("POST /api/demands/{id}/approve-review", s.approveReview)
	h("POST /api/demands/{id}/apply-branch", s.applyBranch)
	h("POST /api/demands/{id}/adjust", s.adjust)
	h("POST /api/demands/{id}/move", s.move)
	h("GET /api/demands/{id}/diff", s.diff)
	h("GET /api/demands/{id}/diff/files", s.diffFiles)
	h("GET /api/demands/{id}/diff/file", s.diffFile)
	h("POST /api/demands/{id}/repair-encoding", func(w http.ResponseWriter, r *http.Request) (any, error) {
		rep, err := s.eng.RepairEncoding(pid(r))
		if err != nil {
			return nil, err
		}
		issues := []string{}
		for _, i := range rep.Issues {
			issues = append(issues, i.String())
		}
		return map[string]any{"restored": len(rep.Restored), "repaired": rep.Repaired, "issues": issues}, nil
	})
	h("POST /api/queue/reorder", s.reorder)
	mux.HandleFunc("GET /api/attachments/{id}", s.downloadAttachment)

	h("GET /api/events", s.listEvents)
	mux.HandleFunc("GET /api/stream", s.stream)

	h("GET /api/rules", s.listRules)
	h("POST /api/rules", s.saveRule)
	h("PUT /api/rules/{id}", s.saveRule)
	h("DELETE /api/rules/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) { return nil, s.st.DeleteRule(pid(r)) })
	h("POST /api/rules/import", s.importRuleFile)
	h("GET /api/rules/preview", s.previewRules)

	h("GET /api/settings", func(w http.ResponseWriter, r *http.Request) (any, error) { return s.st.GetSettings() })
	h("PUT /api/settings", s.saveSettings)
	h("GET /api/providers", s.listProviders)
	h("GET /api/usage", func(w http.ResponseWriter, r *http.Request) (any, error) {
		u, paused := s.eng.Usage()
		st, _ := s.st.GetSettings()
		out := map[string]any{"usage": u, "subscriptionOnly": st.Claude.SubscriptionOnly}
		if time.Now().Before(paused) {
			out["pausedUntil"] = paused
		}
		return out, nil
	})
	h("POST /api/queue/resume", func(w http.ResponseWriter, r *http.Request) (any, error) { s.eng.ResumeQueue(); return nil, nil })
	h("POST /api/providers/{id}/test", s.testProvider)

	sub, _ := fs.Sub(staticFS, "static")
	files := http.FileServer(http.FS(sub))
	mux.Handle("GET /", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	}))
	return s.guard(mux)
}

// guard: proteção contra DNS rebinding e CSRF para uma API que só deve ser
// acessada pelo navegador local.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if host != "localhost" && host != "127.0.0.1" && host != "::1" && host != "[::1]" {
			http.Error(w, "host não permitido", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if r.Header.Get("X-DevPipe") != "1" {
				http.Error(w, "requisição sem cabeçalho X-DevPipe", http.StatusForbidden)
				return
			}
			if o := r.Header.Get("Origin"); o != "" && !strings.Contains(o, "://localhost:") && !strings.Contains(o, "://127.0.0.1:") {
				http.Error(w, "origem não permitida", http.StatusForbidden)
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func pid(r *http.Request) int64 {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id
}

func decode(r *http.Request, v any) error {
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(v); err != nil {
		return fmt.Errorf("JSON inválido: %w", err)
	}
	return nil
}

// ------------------------------------------------------------------ meta

func (s *Server) meta(w http.ResponseWriter, r *http.Request) (any, error) {
	type st struct {
		ID    domain.Stage `json:"id"`
		Label string       `json:"label"`
	}
	var stages []st
	for _, x := range domain.AllStages {
		stages = append(stages, st{x, domain.StageLabels[x]})
	}
	return map[string]any{"version": Version, "stages": stages, "dataDir": s.dataDir}, nil
}

// ------------------------------------------------------------------ projetos

type inspectResult struct {
	Valid      bool              `json:"valid"`
	Message    string            `json:"message"`
	Path       string            `json:"path"`
	Current    string            `json:"current"`
	Branches   []gitx.BranchInfo `json:"branches"`
	Language   string            `json:"language"`
	Solution   string            `json:"solution"`
	Suggested  []string          `json:"suggestedOptions"`
	Dirty      int               `json:"dirty"`
	Authorized bool              `json:"authorized"`
	Standards  []string          `json:"standardsFound"`
	// NeedsInit: a pasta não existe ou ainda não é um repositório Git. O
	// projeto pode ser salvo mesmo assim: o DevPipe cria um repositório local.
	NeedsInit bool `json:"needsInit"`
}

func (s *Server) inspect(path string) inspectResult {
	res := inspectResult{Path: path}
	settings, _ := s.st.GetSettings()
	res.Authorized = security.IsPathAuthorized(path, settings.AuthorizedRoots)
	repo := gitx.Repo{Dir: path}
	top, err := repo.Validate()
	if err != nil {
		res.Message = err.Error()
		if gitx.Available() != nil {
			res.Message = "Git não encontrado no PATH. Instale o Git (git-scm.com) para usar o DevPipe."
			return res
		}
		if !filepath.IsAbs(path) {
			return res
		}
		res.NeedsInit, res.Path = true, filepath.Clean(path)
		if st, e := os.Stat(path); e == nil && st.IsDir() {
			res.Language, res.Solution = gitx.DetectStack(path)
			res.Message = "A pasta ainda não é um repositório Git. Ao salvar, o DevPipe cria um repositório local (branch main, sem remoto) com os arquivos que já estão nela."
		} else if e == nil {
			res.NeedsInit = false
			res.Message = "O caminho aponta para um arquivo, não para uma pasta."
		} else {
			res.Message = "A pasta ainda não existe. Ao salvar, o DevPipe cria a pasta e um repositório Git local (branch main, sem remoto)."
		}
		if !res.Authorized {
			res.Message += " — ATENÇÃO: fora dos diretórios autorizados"
		}
		return res
	}
	res.Valid, res.Path = true, top
	res.Current, _ = repo.CurrentBranch()
	res.Branches, _ = repo.Branches()
	if d, err := repo.StatusPorcelain(); err == nil {
		res.Dirty = len(d)
	}
	res.Language, res.Solution = gitx.DetectStack(top)
	common := map[string]bool{"release": true, "main": true, "main_versao": true, "stage": true, "develop": true, "master": true, "homologacao": true, "staging": true}
	for _, b := range res.Branches {
		if !b.Remote && common[strings.ToLower(b.Name)] {
			res.Suggested = append(res.Suggested, b.Name)
		}
	}
	for _, f := range []string{"CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", ".editorconfig", "docs/padroes.md", ".github/copilot-instructions.md"} {
		if _, err := os.Stat(filepath.Join(top, filepath.FromSlash(f))); err == nil {
			res.Standards = append(res.Standards, f)
		}
	}
	res.Message = "Repositório Git válido"
	if !res.Authorized {
		res.Message += " — ATENÇÃO: fora dos diretórios autorizados"
	}
	return res
}

// ensureRepo valida o caminho do projeto e, se a pasta ainda não for um
// repositório Git (ou nem existir), cria um repositório local. Só atua dentro
// dos diretórios autorizados.
func (s *Server) ensureRepo(path string) (inspectResult, error) {
	ins := s.inspect(path)
	if !ins.Authorized {
		return ins, errors.New("o caminho não está dentro dos diretórios autorizados (Configurações > Segurança)")
	}
	if ins.Valid {
		return ins, nil
	}
	if !ins.NeedsInit {
		return ins, errors.New(ins.Message)
	}
	if _, err := (gitx.Repo{Dir: ins.Path}).Init(); err != nil {
		return ins, fmt.Errorf("não foi possível criar o repositório Git em %s: %w", ins.Path, err)
	}
	s.eng.SystemLog(domain.LevelOK, "git", "Repositório Git local criado para o projeto em "+ins.Path+" (branch main, sem remoto)")
	ins = s.inspect(ins.Path)
	if !ins.Valid {
		return ins, errors.New(ins.Message)
	}
	return ins, nil
}

func (s *Server) inspectProject(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct{ Path string }
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Path) == "" {
		return nil, errors.New("informe o caminho do repositório")
	}
	return s.inspect(strings.TrimSpace(in.Path)), nil
}

func (s *Server) saveProject(w http.ResponseWriter, r *http.Request) (any, error) {
	var p domain.Project
	if err := decode(r, &p); err != nil {
		return nil, err
	}
	p.ID = pid(r)
	p.Name, p.Path = strings.TrimSpace(p.Name), strings.TrimSpace(p.Path)
	if p.Name == "" || p.Path == "" {
		return nil, errors.New("nome e caminho são obrigatórios")
	}
	if !filepath.IsAbs(p.Path) {
		return nil, errors.New("informe o caminho absoluto do repositório")
	}
	for _, c := range []string{p.BuildCommand, p.TestCommand} { // valida antes de criar qualquer coisa no disco
		if err := security.CheckValidationCommand(c); err != nil {
			return nil, err
		}
	}
	ins, err := s.ensureRepo(p.Path)
	if err != nil {
		return nil, err
	}
	p.Path = ins.Path
	for _, c := range []string{p.BuildCommand, p.TestCommand} {
		if err := security.CheckValidationCommand(c); err != nil {
			return nil, err
		}
	}
	if _, rejected := security.BashAllowFromPrefixes(p.AgentBashAllow); len(rejected) > 0 {
		return nil, fmt.Errorf("comandos não permitidos para o agente: %s", strings.Join(rejected, ", "))
	}
	if p.Language == "" {
		p.Language = ins.Language
	}
	if p.MainSolution == "" {
		p.MainSolution = ins.Solution
	}
	switch p.FileEncoding {
	case "", "auto", "windows-1252", "utf-8", "utf-8-bom":
	default:
		return nil, errors.New("codificação inválida")
	}
	if p.ID == 0 && len(p.BranchOptions) == 0 {
		p.BranchOptions = ins.Suggested
	}
	if err := s.st.SaveProject(&p); err != nil {
		return nil, err
	}
	s.eng.SystemLog(domain.LevelInfo, "projeto", "Projeto salvo: "+p.Name+" ("+p.Path+")")
	return p, nil
}

func (s *Server) projectBranches(w http.ResponseWriter, r *http.Request) (any, error) {
	p, err := s.st.GetProject(pid(r))
	if err != nil {
		return nil, err
	}
	return s.inspect(p.Path), nil
}

// ------------------------------------------------------------------ demandas

func (s *Server) listDemands(w http.ResponseWriter, r *http.Request) (any, error) {
	q := r.URL.Query()
	f := store.DemandFilter{Stage: q.Get("stage"), Query: q.Get("q"), Branch: q.Get("branch")}
	f.ProjectID, _ = strconv.ParseInt(q.Get("project"), 10, 64)
	if t, err := time.Parse("2006-01-02", q.Get("from")); err == nil {
		f.From = &t
	}
	if t, err := time.Parse("2006-01-02", q.Get("to")); err == nil {
		t = t.Add(24*time.Hour - time.Second)
		f.To = &t
	}
	return s.st.ListDemands(f)
}

type demandInput struct {
	domain.Demand
	Instructions string `json:"instructions"`
	NewProject   *struct {
		Name string `json:"name"`
		Path string `json:"path"`
	} `json:"newProject"`
}

func (s *Server) createDemand(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return nil, fmt.Errorf("formulário inválido: %w", err)
	}
	defer r.MultipartForm.RemoveAll()
	var in demandInput
	if err := json.Unmarshal([]byte(r.FormValue("data")), &in); err != nil {
		return nil, fmt.Errorf("dados inválidos: %w", err)
	}
	d := in.Demand
	d.Ticket, d.Title = strings.TrimSpace(d.Ticket), strings.TrimSpace(d.Title)
	if d.Ticket == "" || d.Title == "" {
		return nil, errors.New("ticket e título são obrigatórios")
	}
	if in.NewProject != nil && in.NewProject.Path != "" {
		name := in.NewProject.Name
		if name == "" {
			name = filepath.Base(in.NewProject.Path)
		}
		if !filepath.IsAbs(strings.TrimSpace(in.NewProject.Path)) {
			return nil, errors.New("novo projeto inválido: informe o caminho absoluto da pasta")
		}
		path := strings.TrimSpace(in.NewProject.Path)
		pastaSemGit := s.inspect(path).NeedsInit
		ins, err := s.ensureRepo(path)
		if err != nil {
			return nil, fmt.Errorf("novo projeto inválido: %w", err)
		}
		if pastaSemGit {
			// Projeto criado do zero: a pasta indicada é o destino dos arquivos.
			// A demanda trabalha direto na branch main (sem branch devpipe/...)
			// e, ao aprovar a revisão, as alterações são gravadas na própria pasta.
			d.DirectBranch = true
		}
		p := domain.Project{Name: name, Path: ins.Path, Language: ins.Language, MainSolution: ins.Solution, BranchOptions: ins.Suggested, AutoCommit: true}
		if err := s.st.SaveProject(&p); err != nil {
			return nil, err
		}
		d.ProjectID = p.ID
	}
	if _, err := s.st.GetProject(d.ProjectID); err != nil {
		return nil, errors.New("selecione um projeto de destino válido")
	}
	if d.Provider == "" {
		st, _ := s.st.GetSettings()
		d.Provider = st.DefaultProvider
	}
	rev, err := s.st.CreateDemand(&d, in.Instructions)
	if err != nil {
		return nil, err
	}
	names, err := s.saveUploads(r, d.ID, rev)
	if err != nil {
		return nil, err
	}
	full, _ := s.st.GetDemand(d.ID)
	ev := fmt.Sprintf("Demanda cadastrada com %d anexo(s)", len(names))
	s.logDemand(full, domain.LevelInfo, "cadastro", ev, strings.Join(names, "\n"))
	if r.FormValue("enqueue") == "1" {
		if err := s.eng.Enqueue(d.ID); err != nil {
			return nil, err
		}
	}
	return full, nil
}

func (s *Server) logDemand(d domain.Demand, level, kind, msg, detail string) {
	ev := domain.Event{DemandID: d.ID, Ticket: d.Ticket, ProjectID: d.ProjectID, Project: d.ProjectName, Stage: d.Stage, Level: level, Kind: kind, Message: msg, Detail: security.Redact(detail)}
	if s.st.AddEvent(&ev) == nil {
		s.eng.Bus().Publish(pipeline.Message{Type: "event", Data: ev})
		s.eng.Bus().Publish(pipeline.Message{Type: "demand", Data: d})
	}
}

func (s *Server) saveUploads(r *http.Request, demandID int64, rev domain.Revision) ([]string, error) {
	if r.MultipartForm == nil {
		return nil, nil
	}
	dir := s.eng.AttachmentDir(demandID, rev.Number)
	var names []string
	for _, fh := range r.MultipartForm.File["files"] {
		name := filepath.Base(strings.ReplaceAll(fh.Filename, "\\", "/"))
		if err := docs.CheckAllowed(name); err != nil {
			return names, err
		}
		if fh.Size > docs.MaxUploadBytes {
			return names, fmt.Errorf("arquivo %s excede 50 MB", name)
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return names, err
		}
		dest := uniquePath(filepath.Join(dir, safeFileName(name)))
		src, err := fh.Open()
		if err != nil {
			return names, err
		}
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			src.Close()
			return names, err
		}
		n, err := io.Copy(out, io.LimitReader(src, docs.MaxUploadBytes+1))
		src.Close()
		out.Close()
		if err != nil {
			return names, err
		}
		mt := fh.Header.Get("Content-Type")
		if mt == "" {
			mt = mime.TypeByExtension(filepath.Ext(name))
		}
		a := domain.Attachment{DemandID: demandID, RevisionID: rev.ID, FileName: name, StoredPath: dest, Mime: mt, Size: n, Kind: docs.Kind(name)}
		if err := s.st.AddAttachment(&a); err != nil {
			return names, err
		}
		names = append(names, name)
	}
	// texto colado também vira anexo (preserva o original)
	if txt := strings.TrimSpace(r.FormValue("pastedText")); txt != "" {
		os.MkdirAll(dir, 0o755)
		dest := uniquePath(filepath.Join(dir, "texto-colado.md"))
		if err := os.WriteFile(dest, []byte(txt), 0o600); err == nil {
			a := domain.Attachment{DemandID: demandID, RevisionID: rev.ID, FileName: filepath.Base(dest), StoredPath: dest, Mime: "text/markdown", Size: int64(len(txt)), Kind: "texto"}
			s.st.AddAttachment(&a)
			names = append(names, a.FileName)
		}
	}
	return names, nil
}

func safeFileName(n string) string {
	n = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`<>:"/\|?*`, r) || r < 32 {
			return '_'
		}
		return r
	}, n)
	if n == "" || n == "." || n == ".." {
		n = "arquivo"
	}
	return n
}

func uniquePath(p string) string {
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return p
	}
	ext := filepath.Ext(p)
	base := strings.TrimSuffix(p, ext)
	for i := 2; ; i++ {
		c := fmt.Sprintf("%s-%d%s", base, i, ext)
		if _, err := os.Stat(c); os.IsNotExist(err) {
			return c
		}
	}
}

func (s *Server) getDemand(w http.ResponseWriter, r *http.Request) (any, error) {
	id := pid(r)
	d, err := s.st.GetDemand(id)
	if err != nil {
		return nil, err
	}
	revs, _ := s.st.ListRevisions(id)
	atts, _ := s.st.ListAttachments(id)
	runs, _ := s.st.ListRuns(id)
	return map[string]any{"demand": d, "revisions": revs, "attachments": atts, "runs": runs, "running": s.eng.IsRunning(id)}, nil
}

func (s *Server) updateDemand(w http.ResponseWriter, r *http.Request) (any, error) {
	id := pid(r)
	if s.eng.IsRunning(id) {
		return nil, pipeline.ErrBusy
	}
	cur, err := s.st.GetDemand(id)
	if err != nil {
		return nil, err
	}
	var in demandInput
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	d := in.Demand
	d.ID = id
	if strings.TrimSpace(d.Ticket) == "" || strings.TrimSpace(d.Title) == "" {
		return nil, errors.New("ticket e título são obrigatórios")
	}
	if cur.WorkBranch != "" && d.BaseBranch != cur.BaseBranch {
		return nil, errors.New("a branch base não pode ser alterada após a criação da branch de trabalho")
	}
	if cur.WorkBranch != "" && d.DirectBranch != cur.DirectBranch {
		return nil, errors.New("o modo de branch (direto na branch selecionada ou branch própria) não pode ser alterado depois que a demanda começou")
	}
	if err := s.st.UpdateDemandFields(d); err != nil {
		return nil, err
	}
	// instruções da revisão original podem ser editadas enquanto não analisadas
	if cur.Stage == domain.StageBacklog && cur.CurrentRevision == 1 {
		if rev, err := s.st.GetRevision(id, 1); err == nil && rev.Spec == "" && in.Instructions != rev.Instructions {
			s.st.DB().Exec(`UPDATE revisions SET instructions=? WHERE id=?`, in.Instructions, rev.ID)
		}
	}
	full, _ := s.st.GetDemand(id)
	s.logDemand(full, domain.LevelInfo, "edicao", "Demanda editada", "")
	return full, nil
}

func (s *Server) deleteDemand(w http.ResponseWriter, r *http.Request) (any, error) {
	id := pid(r)
	d, err := s.st.GetDemand(id)
	if err != nil {
		return nil, err
	}
	if s.eng.IsRunning(id) || d.Status == domain.StatusQueued {
		return nil, errors.New("cancele ou retire da fila antes de excluir")
	}
	if err := s.st.DeleteDemand(id); err != nil {
		return nil, err
	}
	msg := "Demanda " + d.Ticket + " excluída do cadastro."
	if d.WorktreePath != "" && d.DirectBranch {
		msg += " A área de trabalho " + d.WorktreePath + " foi preservada (remova com git worktree remove se desejar); a branch " + d.WorkBranch + " não foi tocada."
	} else if d.WorktreePath != "" {
		msg += " A branch " + d.WorkBranch + " e a worktree " + d.WorktreePath + " foram preservadas (remova manualmente se desejar)."
	}
	s.eng.SystemLog(domain.LevelWarn, "exclusao", msg)
	return map[string]string{"message": msg}, nil
}

func (s *Server) addAttachments(w http.ResponseWriter, r *http.Request) (any, error) {
	id := pid(r)
	if s.eng.IsRunning(id) {
		return nil, pipeline.ErrBusy
	}
	d, err := s.st.GetDemand(id)
	if err != nil {
		return nil, err
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return nil, err
	}
	defer r.MultipartForm.RemoveAll()
	rev, err := s.st.GetRevision(id, d.CurrentRevision)
	if err != nil {
		return nil, err
	}
	names, err := s.saveUploads(r, id, rev)
	if err != nil {
		return nil, err
	}
	s.logDemand(d, domain.LevelInfo, "anexo", fmt.Sprintf("%d anexo(s) adicionado(s) à revisão %d", len(names), rev.Number), strings.Join(names, "\n"))
	return names, nil
}

func (s *Server) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	a, err := s.st.GetAttachment(pid(r))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	disp := "attachment"
	if a.Kind == "imagem" || a.Kind == "pdf" {
		disp = "inline"
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disp, map[string]string{"filename": a.FileName}))
	if a.Kind != "imagem" && a.Kind != "pdf" {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	http.ServeFile(w, r, a.StoredPath)
}

func (s *Server) approveSpec(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct{ Spec string }
	decode(r, &in)
	return nil, s.eng.ApproveSpec(pid(r), in.Spec)
}

func (s *Server) approveReview(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct{ Note string }
	decode(r, &in)
	return nil, s.eng.ApproveReview(pid(r), in.Note)
}

func (s *Server) applyBranch(w http.ResponseWriter, r *http.Request) (any, error) {
	msg, err := s.eng.ApplyToBranch(pid(r))
	if err != nil {
		return nil, err
	}
	return map[string]string{"message": msg}, nil
}

func (s *Server) adjust(w http.ResponseWriter, r *http.Request) (any, error) {
	id := pid(r)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return nil, err
	}
	defer r.MultipartForm.RemoveAll()
	rev, err := s.eng.NewAdjustment(id, strings.TrimSpace(r.FormValue("instructions")))
	if err != nil {
		return nil, err
	}
	if _, err := s.saveUploads(r, id, rev); err != nil {
		return nil, err
	}
	return rev, s.eng.FinishAdjustment(id, rev, r.FormValue("enqueue") == "1")
}

func (s *Server) move(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct{ Stage domain.Stage }
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	return nil, s.eng.Move(pid(r), in.Stage)
}

func (s *Server) diff(w http.ResponseWriter, r *http.Request) (any, error) {
	d, err := s.st.GetDemand(pid(r))
	if err != nil {
		return nil, err
	}
	if d.WorktreePath == "" || d.DiffBase() == "" {
		return map[string]string{"diff": "", "stat": "", "message": "A branch de trabalho ainda não foi criada."}, nil
	}
	if _, err := os.Stat(d.WorktreePath); err != nil {
		return map[string]string{"diff": "", "message": "Worktree não encontrada: " + d.WorktreePath}, nil
	}
	repo := gitx.Repo{Dir: d.WorktreePath}
	return map[string]string{"diff": security.Redact(displayText(repo.Diff(d.DiffBase(), 400<<10))), "stat": repo.DiffStat(d.DiffBase()),
		"branch": d.WorkBranch, "base": d.BaseBranch, "worktree": d.WorktreePath}, nil
}

// diffRepo resolve a worktree da demanda para o comparador.
func (s *Server) diffRepo(r *http.Request) (domain.Demand, gitx.Repo, string, error) {
	d, err := s.st.GetDemand(pid(r))
	if err != nil {
		return d, gitx.Repo{}, "", err
	}
	if d.WorktreePath == "" || d.DiffBase() == "" {
		return d, gitx.Repo{}, "A área de trabalho da demanda ainda não foi criada.", nil
	}
	if _, err := os.Stat(d.WorktreePath); err != nil {
		return d, gitx.Repo{}, "Worktree não encontrada: " + d.WorktreePath, nil
	}
	return d, gitx.Repo{Dir: d.WorktreePath}, "", nil
}

func (s *Server) diffFiles(w http.ResponseWriter, r *http.Request) (any, error) {
	d, repo, msg, err := s.diffRepo(r)
	if err != nil || msg != "" {
		return map[string]any{"files": []any{}, "message": msg}, err
	}
	files, err := repo.DiffFiles(d.DiffBase())
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = []gitx.FileChange{}
	}
	base := d.BaseBranch
	if d.DirectBranch && d.BaseCommit != "" {
		base = d.WorkBranch + " @ " + d.BaseCommit[:min(10, len(d.BaseCommit))]
	}
	return map[string]any{"files": files, "branch": d.WorkBranch, "base": base, "worktree": d.WorktreePath, "direct": d.DirectBranch}, nil
}

func (s *Server) diffFile(w http.ResponseWriter, r *http.Request) (any, error) {
	d, repo, msg, err := s.diffRepo(r)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return nil, errors.New(msg)
	}
	path := r.URL.Query().Get("path")
	files, err := repo.DiffFiles(d.DiffBase())
	if err != nil {
		return nil, err
	}
	var fc *gitx.FileChange
	for i := range files {
		if files[i].Path == path {
			fc = &files[i]
		}
	}
	if fc == nil {
		return nil, errors.New("arquivo não faz parte das alterações da demanda")
	}
	if fc.Binary {
		return map[string]any{"file": fc, "binary": true, "diff": ""}, nil
	}
	raw, err := repo.FileDiff(d.DiffBase(), path)
	if err != nil {
		return nil, err
	}
	const limite = 4 << 20
	trunc := len(raw) > limite
	if trunc {
		raw = raw[:limite]
	}
	return map[string]any{"file": fc, "diff": security.Redact(displayText(string(raw))), "truncated": trunc}, nil
}

func (s *Server) reorder(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct{ IDs []int64 }
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	return nil, s.eng.Reorder(in.IDs)
}

// ------------------------------------------------------------------ eventos

func (s *Server) listEvents(w http.ResponseWriter, r *http.Request) (any, error) {
	q := r.URL.Query()
	f := store.EventFilter{Level: q.Get("level")}
	f.DemandID, _ = strconv.ParseInt(q.Get("demand"), 10, 64)
	f.RunID, _ = strconv.ParseInt(q.Get("run"), 10, 64)
	f.AfterID, _ = strconv.ParseInt(q.Get("after"), 10, 64)
	f.Limit, _ = strconv.Atoi(q.Get("limit"))
	return s.st.ListEvents(f)
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming não suportado", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch := s.eng.Bus().Subscribe()
	defer s.eng.Bus().Unsubscribe(ch)
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	fmt.Fprint(w, "retry: 3000\n\n")
	fl.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		case m := <-ch:
			b, _ := json.Marshal(m)
			fmt.Fprintf(w, "data: %s\n\n", b)
			fl.Flush()
		}
	}
}

// ------------------------------------------------------------------ regras

func (s *Server) listRules(w http.ResponseWriter, r *http.Request) (any, error) {
	pidq := int64(-1)
	if v := r.URL.Query().Get("project"); v != "" {
		pidq, _ = strconv.ParseInt(v, 10, 64)
	}
	return s.st.ListRules(pidq, false)
}

func (s *Server) saveRule(w http.ResponseWriter, r *http.Request) (any, error) {
	var ru domain.Rule
	if err := decode(r, &ru); err != nil {
		return nil, err
	}
	ru.ID = pid(r)
	if strings.TrimSpace(ru.Title) == "" || strings.TrimSpace(ru.Content) == "" {
		return nil, errors.New("título e conteúdo são obrigatórios")
	}
	if ru.Scope == "projeto" {
		if _, err := s.st.GetProject(ru.ProjectID); err != nil {
			return nil, errors.New("selecione o projeto da regra")
		}
	}
	if ru.Priority == 0 {
		ru.Priority = 100
	}
	if err := s.st.SaveRule(&ru); err != nil {
		return nil, err
	}
	s.eng.SystemLog(domain.LevelInfo, "regra", fmt.Sprintf("Regra salva: %s (v%d)", ru.Title, ru.Version))
	return ru, nil
}

// importRuleFile cria uma regra a partir de um arquivo .md/.txt anexado.
func (s *Server) importRuleFile(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		return nil, err
	}
	defer r.MultipartForm.RemoveAll()
	f, fh, err := r.FormFile("file")
	if err != nil {
		return nil, errors.New("selecione um arquivo")
	}
	defer f.Close()
	tmp, err := os.CreateTemp("", "regra-*"+filepath.Ext(fh.Filename))
	if err != nil {
		return nil, err
	}
	io.Copy(tmp, io.LimitReader(f, 5<<20))
	tmp.Close()
	defer os.Remove(tmp.Name())
	text, note := docs.Extract(tmp.Name())
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("não foi possível extrair texto: " + note)
	}
	ru := domain.Rule{Scope: r.FormValue("scope"), Title: strings.TrimSuffix(fh.Filename, filepath.Ext(fh.Filename)), Category: "Importada",
		Content: text, Enabled: true, Priority: 100}
	ru.ProjectID, _ = strconv.ParseInt(r.FormValue("projectId"), 10, 64)
	if err := s.st.SaveRule(&ru); err != nil {
		return nil, err
	}
	return ru, nil
}

func (s *Server) previewRules(w http.ResponseWriter, r *http.Request) (any, error) {
	id, _ := strconv.ParseInt(r.URL.Query().Get("project"), 10, 64)
	p, err := s.st.GetProject(id)
	if err != nil {
		return nil, err
	}
	all, _ := s.st.ListRules(p.ID, true)
	c := rules.Compose(all, p, p.Path)
	return map[string]string{"text": security.SecurityPreamble + "\n\n" + c.Text, "hash": c.Hash}, nil
}

// ------------------------------------------------------------------ configurações e provedores

func (s *Server) saveSettings(w http.ResponseWriter, r *http.Request) (any, error) {
	var st domain.Settings
	if err := decode(r, &st); err != nil {
		return nil, err
	}
	if st.MaxParallel < 1 {
		st.MaxParallel = 1
	}
	switch st.Claude.Effort {
	case "", "low", "medium", "high", "xhigh", "max":
	default:
		return nil, errors.New("nível de esforço inválido")
	}
	if st.Claude.PermissionMode == "bypassPermissions" {
		return nil, errors.New("o modo bypassPermissions não é permitido na esteira")
	}
	st.CommitAuthorName, st.CommitAuthorEmail = strings.TrimSpace(st.CommitAuthorName), strings.TrimSpace(st.CommitAuthorEmail)
	if strings.ContainsAny(st.CommitAuthorName+st.CommitAuthorEmail, "<>\n\r") || (st.CommitAuthorEmail != "" && !strings.Contains(st.CommitAuthorEmail, "@")) {
		return nil, errors.New("nome ou e-mail do autor dos commits inválido")
	}
	clean := st.AuthorizedRoots[:0]
	for _, root := range st.AuthorizedRoots {
		if root = strings.TrimSpace(root); root != "" {
			if !filepath.IsAbs(root) {
				return nil, fmt.Errorf("diretório autorizado deve ser absoluto: %s", root)
			}
			clean = append(clean, root)
		}
	}
	st.AuthorizedRoots = clean
	if err := s.st.SaveSettings(st); err != nil {
		return nil, err
	}
	ConfigureProviders(s.reg, st)
	s.eng.SystemLog(domain.LevelInfo, "configuracao", "Configurações atualizadas")
	s.eng.Wake()
	return st, nil
}

func (s *Server) listProviders(w http.ResponseWriter, r *http.Request) (any, error) {
	type pv struct {
		ID     string                `json:"id"`
		Name   string                `json:"name"`
		Images bool                  `json:"images"`
		Status provider.Availability `json:"status"`
	}
	var out []pv
	for _, p := range s.reg.List() {
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		out = append(out, pv{p.ID(), p.Name(), p.SupportsImages(), p.Check(ctx)})
		cancel()
	}
	return out, nil
}

// testProvider faz uma chamada mínima real (consome poucos tokens) para
// confirmar instalação e autenticação.
func (s *Server) testProvider(w http.ResponseWriter, r *http.Request) (any, error) {
	p, err := s.reg.Get(r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "devpipe-probe-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	var events []string
	res, err := p.Run(ctx, provider.Request{Phase: provider.PhaseProbe, WorkDir: dir, Prompt: "Responda apenas com a palavra PRONTO."},
		func(e provider.Event) { events = append(events, e.Message) })
	s.eng.SetUsage(res.Usage)
	if err != nil {
		s.eng.SystemLog(domain.LevelError, "provedor", "Teste de conexão falhou: "+p.Name()+" — "+err.Error())
		return map[string]any{"ok": false, "message": security.Redact(err.Error()), "events": events, "authMode": res.AuthMode}, nil
	}
	s.eng.SystemLog(domain.LevelOK, "provedor", "Teste de conexão bem-sucedido: "+p.Name()+" (autenticação: "+res.AuthMode+")")
	return map[string]any{"ok": true, "message": strings.TrimSpace(res.Text), "cost": res.CostUSD, "events": events, "authMode": res.AuthMode, "usage": res.Usage}, nil
}

// displayText exibe corretamente diffs de arquivos Windows-1252 (linha a linha).
func displayText(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		if !utf8.ValidString(l) {
			lines[i] = encx.DecodeCP1252([]byte(l))
		}
	}
	return strings.Join(lines, "\n")
}

// fazenda devolve o estado do painel "Fazenda da Esteira" (somente leitura).
func (s *Server) fazenda(w http.ResponseWriter, r *http.Request) (any, error) {
	settings, _ := s.st.GetSettings()
	ds, err := s.st.ListDemands(store.DemandFilter{})
	if err != nil {
		return nil, err
	}
	entrou, _ := s.st.StageEnteredAt()
	sizes, _ := s.st.SpecSizes()
	now := time.Now()
	dels, _ := s.st.DeliveriesSince(now.AddDate(0, 0, -8))
	in := fazenda.Entrada{Demandas: ds, EntrouNaEtapa: entrou, SpecSizes: sizes, Running: s.eng.IsRunning}
	for _, d := range dels {
		in.Entregas = append(in.Entregas, fazenda.Entrega{DemandID: d.DemandID, At: d.At})
	}
	est := fazenda.Calcular(in, fazenda.Default(settings.MaxParallel), now, time.Local)
	u, paused := s.eng.Usage()
	return map[string]any{"estado": est, "uso": u, "filaPausada": now.Before(paused), "versao": Version}, nil
}
