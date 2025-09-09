const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('sqlite3').Database;
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const lusca = require('lusca');
class PublisherModule {
  constructor() {
    this.router = express.Router();
    this.db = null;
    this.config = null;
    this.logger = null;
  }

  async initialize(config) {
    this.config = config;
    this.logger = require('../common/logger').getInstance().child({ module: 'publisher' });

    // Initialize database first
    await this.initializeDatabase();

    // Set up session middleware - use in-memory sessions or separate session db
    this.router.use(session({
      secret: this.config.sessionSecret || 'your-secret-key-change-this',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 } // 24 hours
      // Not using SQLiteStore to avoid the database conflict
    }));

    // Add CSRF protection middleware
    this.router.use(lusca.csrf());

    // Parse form data
    this.router.use(express.urlencoded({ extended: true }));

    // Set up routes
    this.setupRoutes();

    this.logger.info('Publisher module initialized');
  }

  async initializeDatabase() {
    return new Promise((resolve, reject) => {
      this.db = new Database(this.config.database, (err) => {
        if (err) {
          this.logger.error('Failed to connect to database:', err);
          reject(err);
          return;
        }

        this.logger.info('Connected to SQLite database');
        this.createTables().then(resolve).catch(reject);
      });
    });
  }

  async createTables() {
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                            name TEXT NOT NULL,
                                            login TEXT UNIQUE NOT NULL,
                                            password_hash TEXT NOT NULL,
                                            is_admin BOOLEAN DEFAULT 0,
                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
       )`,

      // Websites table
      `CREATE TABLE IF NOT EXISTS websites (
                                               id INTEGER PRIMARY KEY AUTOINCREMENT,
                                               name TEXT NOT NULL,
                                               local_folder TEXT NOT NULL,
                                               server_update_script TEXT NOT NULL,
                                               is_active BOOLEAN DEFAULT 1,
                                               created_at DATETIME DEFAULT CURRENT_TIMESTAMP
       )`,

      // User website permissions
      `CREATE TABLE IF NOT EXISTS user_website_permissions (
                                                               user_id INTEGER,
                                                               website_id INTEGER,
                                                               can_queue BOOLEAN DEFAULT 0,
                                                               can_approve BOOLEAN DEFAULT 0,
                                                               PRIMARY KEY (user_id, website_id),
          FOREIGN KEY (user_id) REFERENCES users (id),
          FOREIGN KEY (website_id) REFERENCES websites (id)
          )`,

      // Tasks table
      `CREATE TABLE IF NOT EXISTS tasks (
                                            id TEXT PRIMARY KEY,
                                            user_id INTEGER NOT NULL,
                                            website_id INTEGER NOT NULL,
                                            status TEXT DEFAULT 'queued',
                                            github_org TEXT NOT NULL,
                                            github_repo TEXT NOT NULL,
                                            git_branch TEXT NOT NULL,
                                            npm_package_id TEXT NOT NULL,
                                            version TEXT NOT NULL,
                                            local_folder TEXT,
                                            build_output_path TEXT,
                                            failure_reason TEXT,
                                            approved_by INTEGER,
                                            queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                            building_at DATETIME,
                                            waiting_approval_at DATETIME,
                                            publishing_at DATETIME,
                                            completed_at DATETIME,
                                            failed_at DATETIME,
                                            FOREIGN KEY (user_id) REFERENCES users (id),
          FOREIGN KEY (website_id) REFERENCES websites (id),
          FOREIGN KEY (approved_by) REFERENCES users (id)
          )`,

      // Task logs
      `CREATE TABLE IF NOT EXISTS task_logs (
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                task_id TEXT NOT NULL,
                                                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                level TEXT NOT NULL,
                                                message TEXT NOT NULL,
                                                FOREIGN KEY (task_id) REFERENCES tasks (id)
          )`,

      // User actions audit
      `CREATE TABLE IF NOT EXISTS user_actions (
                                                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                   user_id INTEGER,
                                                   action TEXT NOT NULL,
                                                   target_id TEXT,
                                                   timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                   ip_address TEXT,
                                                   FOREIGN KEY (user_id) REFERENCES users (id)
          )`
    ];

    for (const sql of tables) {
      await new Promise((resolve, reject) => {
        this.db.run(sql, (err) => {
          if (err) {
            this.logger.error('Failed to create table:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    // Create default admin user if none exists
    await this.createDefaultAdmin();
  }

  async createDefaultAdmin() {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT COUNT(*) as count FROM users WHERE is_admin = 1', (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (row.count === 0) {
          const defaultPassword = 'admin123'; // Change this!
          bcrypt.hash(defaultPassword, 10, (err, hash) => {
            if (err) {
              reject(err);
              return;
            }

            this.db.run(
              'INSERT INTO users (name, login, password_hash, is_admin) VALUES (?, ?, ?, ?)',
              ['Administrator', 'admin', hash, 1],
              (err) => {
                if (err) {
                  this.logger.error('Failed to create default admin:', err);
                  reject(err);
                } else {
                  this.logger.warn('Created default admin user - login: admin, password: admin123 - CHANGE THIS!');
                  resolve();
                }
              }
            );
          });
        } else {
          resolve();
        }
      });
    });
  }

  setupRoutes() {
    // Main dashboard
    this.router.get('/', this.renderDashboard.bind(this));

    // Authentication
    this.router.get('/login', this.renderLogin.bind(this));
    this.router.post('/login', this.handleLogin.bind(this));
    this.router.post('/logout', this.handleLogout.bind(this));

    // Tasks
    this.router.get('/tasks', this.renderTasks.bind(this));
    this.router.post('/tasks', this.requireAuth.bind(this), this.createTask.bind(this));
    this.router.post('/tasks/:id/approve', this.requireAuth.bind(this), this.approveTask.bind(this));
    this.router.get('/tasks/:id/output', this.getTaskOutput.bind(this));

    // Admin routes
    this.router.get('/admin/websites', this.requireAdmin.bind(this), this.renderWebsites.bind(this));
    this.router.post('/admin/websites', this.requireAdmin.bind(this), this.createWebsite.bind(this));
    this.router.get('/admin/users', this.requireAdmin.bind(this), this.renderUsers.bind(this));
    this.router.post('/admin/users', this.requireAdmin.bind(this), this.createUser.bind(this));
    this.router.post('/admin/permissions', this.requireAdmin.bind(this), this.updatePermissions.bind(this));
  }

  // Middleware
  requireAuth(req, res, next) {
    if (!req.session.userId) {
      return res.redirect('/publisher/login');
    }
    next();
  }

  requireAdmin(req, res, next) {
    if (!req.session.userId || !req.session.isAdmin) {
      return res.status(403).send('Admin access required');
    }
    next();
  }

  // Route handlers
  async renderDashboard(req, res) {
    try {
      const htmlServer = require('../common/html-server');

      // Get recent tasks
      const tasks = await this.getTasks(10);

      let content = '<div class="row mb-4">';
      content += '<div class="col-12">';

      if (req.session.userId) {
        content += '<p>Welcome, ' + req.session.userName + '!</p>';
        content += '<div class="mb-3">';
        content += '<a href="/publisher/tasks" class="btn btn-primary me-2">View All Tasks</a>';
        if (req.session.isAdmin) {
          content += '<a href="/publisher/admin/websites" class="btn btn-secondary me-2">Manage Websites</a>';
          content += '<a href="/publisher/admin/users" class="btn btn-secondary">Manage Users</a>';
        }
        content += '<form style="display: inline-block; margin-left: 10px;" method="post" action="/publisher/logout">';
        content += '<button type="submit" class="btn btn-outline-secondary">Logout</button>';
        content += '</form>';
        content += '</div>';
      } else {
        content += '<p><a href="/publisher/login" class="btn btn-primary">Login</a> to create and manage publication tasks.</p>';
      }

      // Recent tasks
      content += '<h3>Recent Tasks</h3>';
      if (tasks.length === 0) {
        content += '<p>No tasks found.</p>';
      } else {
        content += '<div class="table-responsive">';
        content += '<table class="table table-striped">';
        content += '<thead><tr><th>ID</th><th>Package</th><th>Version</th><th>Status</th><th>Queued</th><th>User</th></tr></thead>';
        content += '<tbody>';

        tasks.forEach(task => {
          content += '<tr>';
          content += '<td><strong>#' + task.id + '</strong></td>';
          content += '<td>' + task.npm_package_id + '</td>';
          content += '<td>' + task.version + '</td>';
          content += '<td><span class="badge bg-' + this.getStatusColor(task.status) + '">' + task.status + '</span></td>';
          content += '<td>' + new Date(task.queued_at).toLocaleString() + '</td>';
          content += '<td>' + task.user_name + '</td>';
          content += '</tr>';
        });

        content += '</tbody></table>';
        content += '</div>';
      }

      content += '</div>';
      content += '</div>';

      const html = htmlServer.renderPage('publisher', 'FHIR Publisher', content, {
        taskCount: tasks.length
      });

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      this.logger.error('Error rendering dashboard:', error);
      res.status(500).send('Internal server error');
    }
  }

  renderLogin(req, res) {
    const htmlServer = require('../common/html-server');

    let content = '<div class="row justify-content-center">';
    content += '<div class="col-md-6">';
    content += '<h3>Login</h3>';
    content += '<form method="post" action="/publisher/login">';
    content += '<div class="mb-3">';
    content += '<label for="login" class="form-label">Username</label>';
    content += '<input type="text" class="form-control" id="login" name="login" required>';
    content += '</div>';
    content += '<div class="mb-3">';
    content += '<label for="password" class="form-label">Password</label>';
    content += '<input type="password" class="form-control" id="password" name="password" required>';
    content += '</div>';
    content += '<button type="submit" class="btn btn-primary">Login</button>';
    content += '</form>';
    content += '</div>';
    content += '</div>';

    const html = htmlServer.renderPage('publisher', 'Login - FHIR Publisher', content);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  async handleLogin(req, res) {
    try {
      const { login, password } = req.body;

      const user = await new Promise((resolve, reject) => {
        this.db.get(
          'SELECT * FROM users WHERE login = ?',
          [login],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (!user) {
        return res.redirect('/publisher/login?error=invalid');
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        return res.redirect('/publisher/login?error=invalid');
      }

      req.session.userId = user.id;
      req.session.userName = user.name;
      req.session.isAdmin = user.is_admin;

      // Log the action
      this.logUserAction(user.id, 'login', null, req.ip);

      res.redirect('/publisher');
    } catch (error) {
      this.logger.error('Login error:', error);
      res.redirect('/publisher/login?error=server');
    }
  }

  handleLogout(req, res) {
    req.session.destroy();
    res.redirect('/publisher');
  }

  async renderTasks(req, res) {
    try {
      const htmlServer = require('../common/html-server');
      const tasks = await this.getTasks();
      const userWebsites = req.session.userId ? await this.getUserWebsites(req.session.userId) : [];

      let content = '<div class="row mb-4">';

      // Create task form for logged in users
      if (req.session.userId && userWebsites.length > 0) {
        content += '<div class="col-12 mb-4">';
        content += '<h3>Create New Publication Task</h3>';
        content += '<form id="create-task-form" method="post" action="/publisher/tasks" class="row g-3">';
        content += '<div class="col-md-3">';
        content += '<label for="website_id" class="form-label">Target Website</label>';
        content += '<select class="form-select" id="website_id" name="website_id" required>';
        userWebsites.forEach(website => {
          content += '<option value="' + website.id + '">' + website.name + '</option>';
        });
        content += '</select>';
        content += '</div>';
        content += '<div class="col-md-3">';
        content += '<label for="github_org" class="form-label">GitHub Org</label>';
        content += '<input type="text" class="form-control" id="github_org" name="github_org" required placeholder="hl7">';
        content += '</div>';
        content += '<div class="col-md-3">';
        content += '<label for="github_repo" class="form-label">GitHub Repo</label>';
        content += '<input type="text" class="form-control" id="github_repo" name="github_repo" required placeholder="fhir-us-core">';
        content += '</div>';
        content += '<div class="col-md-3">';
        content += '<label for="git_branch" class="form-label">Branch</label>';
        content += '<input type="text" class="form-control" id="git_branch" name="git_branch" required placeholder="main">';
        content += '</div>';
        content += '<div class="col-md-4">';
        content += '<label for="npm_package_id" class="form-label">NPM Package ID</label>';
        content += '<input type="text" class="form-control" id="npm_package_id" name="npm_package_id" required placeholder="hl7.fhir.us.core">';
        content += '</div>';
        content += '<div class="col-md-4">';
        content += '<label for="version" class="form-label">Version</label>';
        content += '<input type="text" class="form-control" id="version" name="version" required placeholder="6.0.0">';
        content += '</div>';
        content += '<div class="col-md-4 d-flex align-items-end">';
        content += '<button type="submit" class="btn btn-primary">Create Task</button>';
        content += '</div>';
        content += '</form>';
        content += '</div>';
      }

      // Tasks list
      content += '<div class="col-12">';
      content += '<h3>Publication Tasks</h3>';

      if (tasks.length === 0) {
        content += '<p>No tasks found.</p>';
      } else {
        content += '<div class="table-responsive">';
        content += '<table class="table table-striped">';
        content += '<thead><tr><th>Package</th><th>Version</th><th>Website</th><th>Status</th><th>Queued</th><th>User</th><th>Actions</th></tr></thead>';
        content += '<tbody>';

        for (const task of tasks) {
          const canApprove = req.session.userId && task.status === 'waiting for approval' &&
            await this.userCanApprove(req.session.userId, task.website_id);

          content += '<tr>';
          content += '<td><code>' + task.npm_package_id + '</code></td>';
          content += '<td>' + task.version + '</td>';
          content += '<td>' + task.website_name + '</td>';
          content += '<td><span class="badge bg-' + this.getStatusColor(task.status) + '">' + task.status + '</span></td>';
          content += '<td>' + new Date(task.queued_at).toLocaleString() + '</td>';
          content += '<td>' + task.user_name + '</td>';
          content += '<td class="task-actions">';

          if (task.status === 'waiting for approval') {
            content += '<a href="/publisher/tasks/' + task.id + '/output" class="btn btn-sm btn-outline-info">View Output</a>';
            if (canApprove) {
              content += '<form method="post" action="/publisher/tasks/' + task.id + '/approve" style="display: inline;">';
              content += '<button type="submit" name="approve" class="btn btn-sm btn-success">Approve</button>';
              content += '</form>';
            }
          } else if (task.build_output_path) {
            content += '<a href="/publisher/tasks/' + task.id + '/output" class="btn btn-sm btn-outline-info">View Output</a>';
          }

          content += '</td>';
          content += '</tr>';
        }

        content += '</tbody></table>';
        content += '</div>';
      }

      content += '</div>';
      content += '</div>';

      const html = htmlServer.renderPage('publisher', 'Tasks - FHIR Publisher', content);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      this.logger.error('Error rendering tasks:', error);
      res.status(500).send('Internal server error');
    }
  }

  async createTask(req, res) {
    try {
      const { website_id, github_org, github_repo, git_branch, npm_package_id, version } = req.body;

      // Verify user has permission for this website
      const canQueue = await this.userCanQueue(req.session.userId, website_id);
      if (!canQueue) {
        return res.status(403).send('You do not have permission to create tasks for this website');
      }

      // Check for duplicate tasks
      const existingTask = await this.findExistingTask(npm_package_id, version);
      if (existingTask && existingTask.status !== 'complete' && existingTask.status !== 'failed') {
        return res.status(400).send('A task for this package and version is already in progress');
      }

      // Generate task ID
      const taskId = npm_package_id + '#' + version;

      // Insert task
      await new Promise((resolve, reject) => {
        this.db.run(
          'INSERT INTO tasks (id, user_id, website_id, github_org, github_repo, git_branch, npm_package_id, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [taskId, req.session.userId, website_id, github_org, github_repo, git_branch, npm_package_id, version],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Log the action
      this.logUserAction(req.session.userId, 'create_task', taskId, req.ip);

      this.logger.info('Task created: ' + taskId + ' by user ' + req.session.userId);
      res.redirect('/publisher/tasks');
    } catch (error) {
      this.logger.error('Error creating task:', error);
      res.status(500).send('Failed to create task');
    }
  }

  async approveTask(req, res) {
    try {
      const taskId = req.params.id;

      // Get task details
      const task = await this.getTask(taskId);
      if (!task) {
        return res.status(404).send('Task not found');
      }

      if (task.status !== 'waiting for approval') {
        return res.status(400).send('Task is not waiting for approval');
      }

      // Check user permissions
      const canApprove = await this.userCanApprove(req.session.userId, task.website_id);
      if (!canApprove) {
        return res.status(403).send('You do not have permission to approve tasks for this website');
      }

      // Update task status
      await new Promise((resolve, reject) => {
        this.db.run(
          'UPDATE tasks SET status = ?, approved_by = ?, publishing_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['publishing', req.session.userId, taskId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Log the action
      this.logUserAction(req.session.userId, 'approve_task', taskId, req.ip);

      this.logger.info('Task approved: ' + taskId + ' by user ' + req.session.userId);
      res.redirect('/publisher/tasks');
    } catch (error) {
      this.logger.error('Error approving task:', error);
      res.status(500).send('Failed to approve task');
    }
  }

  async getTaskOutput(req, res) {
    try {
      const taskId = req.params.id;
      const task = await this.getTask(taskId);

      if (!task) {
        return res.status(404).send('Task not found');
      }

      // Get task logs
      const logs = await this.getTaskLogs(taskId);

      // Get build log if available
      let buildLog = '';
      if (task.build_output_path && fs.existsSync(task.build_output_path)) {
        try {
          buildLog = fs.readFileSync(task.build_output_path, 'utf8');
        } catch (error) {
          buildLog = 'Error reading build log: ' + error.message;
        }
      }

      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        const htmlServer = require('../common/html-server');
        let content = '<h3>Task Output: #' + task.id + ' - ' + task.npm_package_id + '#' + task.version + '</h3>';
        content += '<p><strong>Status:</strong> <span class="badge bg-' + this.getStatusColor(task.status) + '">' + task.status + '</span></p>';
        content += '<p><strong>GitHub:</strong> ' + task.github_org + '/' + task.github_repo + ' (' + task.git_branch + ')</p>';

        if (task.local_folder) {
          content += '<p><strong>Local Folder:</strong> <code>' + task.local_folder + '</code></p>';
        }

        if (task.failure_reason) {
          content += '<div class="alert alert-danger"><strong>Failure Reason:</strong> ' + task.failure_reason + '</div>';
        }

        // Task logs section
        content += '<h4>Task Logs</h4>';
        if (logs.length === 0) {
          content += '<p>No task logs available yet.</p>';
        } else {
          content += '<div class="output-viewer" style="max-height: 300px;">';
          logs.forEach(log => {
            const timestamp = new Date(log.timestamp).toLocaleString();
            const levelClass = log.level === 'error' ? 'text-danger' : (log.level === 'warn' ? 'text-warning' : '');
            content += '<div class="' + levelClass + '">[' + timestamp + '] [' + log.level.toUpperCase() + '] ' + log.message + '</div>';
          });
          content += '</div>';
        }

        // Build log section
        if (buildLog) {
          content += '<h4>Build Log</h4>';
          content += '<div class="output-viewer">' + this.escapeHtml(buildLog) + '</div>';
        } else if (task.status === 'building') {
          content += '<h4>Build Log</h4>';
          content += '<p><em>Build in progress... Log will appear when available.</em></p>';
        }

        content += '<div class="mt-3"><a href="/publisher/tasks" class="btn btn-secondary">Back to Tasks</a></div>';

        const html = htmlServer.renderPage('publisher', 'Task Output - FHIR Publisher', content);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      } else {
        // Return plain text logs
        let output = 'Task #' + task.id + ' - ' + task.npm_package_id + '#' + task.version + '\n';
        output += 'Status: ' + task.status + '\n';
        output += 'GitHub: ' + task.github_org + '/' + task.github_repo + ' (' + task.git_branch + ')\n';

        if (task.local_folder) {
          output += 'Local Folder: ' + task.local_folder + '\n';
        }

        output += '\n';

        if (task.failure_reason) {
          output += 'Failure Reason: ' + task.failure_reason + '\n\n';
        }

        output += 'Task Logs:\n';
        logs.forEach(log => {
          const timestamp = new Date(log.timestamp).toLocaleString();
          output += '[' + timestamp + '] [' + log.level.toUpperCase() + '] ' + log.message + '\n';
        });

        if (buildLog) {
          output += '\n--- Build Log ---\n';
          output += buildLog;
        }

        res.setHeader('Content-Type', 'text/plain');
        res.send(output);
      }
    } catch (error) {
      this.logger.error('Error getting task output:', error);
      res.status(500).send('Failed to get task output');
    }
  }

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async getTaskLogs(taskId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC',
        [taskId.toString()],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  async renderWebsites(req, res) {
    try {
      const htmlServer = require('../common/html-server');
      const websites = await this.getWebsites();

      let content = '<div class="row mb-4">';

      // Add website form
      content += '<div class="col-12 mb-4">';
      content += '<h3>Add New Website</h3>';
      content += '<form method="post" action="/publisher/admin/websites" class="row g-3">';
      content += '<div class="col-md-4">';
      content += '<label for="name" class="form-label">Website Name</label>';
      content += '<input type="text" class="form-control" id="name" name="name" required>';
      content += '</div>';
      content += '<div class="col-md-4">';
      content += '<label for="local_folder" class="form-label">Local Folder</label>';
      content += '<input type="text" class="form-control" id="local_folder" name="local_folder" required>';
      content += '</div>';
      content += '<div class="col-md-4">';
      content += '<label for="server_update_script" class="form-label">Update Script</label>';
      content += '<input type="text" class="form-control" id="server_update_script" name="server_update_script" required>';
      content += '</div>';
      content += '<div class="col-12">';
      content += '<button type="submit" class="btn btn-primary">Add Website</button>';
      content += '</div>';
      content += '</form>';
      content += '</div>';

      // Websites list
      content += '<div class="col-12">';
      content += '<h3>Websites</h3>';

      if (websites.length === 0) {
        content += '<p>No websites configured.</p>';
      } else {
        content += '<div class="table-responsive">';
        content += '<table class="table table-striped">';
        content += '<thead><tr><th>Name</th><th>Local Folder</th><th>Update Script</th><th>Active</th><th>Created</th></tr></thead>';
        content += '<tbody>';

        websites.forEach(website => {
          content += '<tr>';
          content += '<td>' + website.name + '</td>';
          content += '<td><code>' + website.local_folder + '</code></td>';
          content += '<td><code>' + website.server_update_script + '</code></td>';
          content += '<td>' + (website.is_active ? '✓' : '✗') + '</td>';
          content += '<td>' + new Date(website.created_at).toLocaleString() + '</td>';
          content += '</tr>';
        });

        content += '</tbody></table>';
        content += '</div>';
      }

      content += '</div>';
      content += '</div>';

      const html = htmlServer.renderPage('publisher', 'Websites - FHIR Publisher', content);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      this.logger.error('Error rendering websites:', error);
      res.status(500).send('Internal server error');
    }
  }

  async createWebsite(req, res) {
    try {
      const { name, local_folder, server_update_script } = req.body;

      await new Promise((resolve, reject) => {
        this.db.run(
          'INSERT INTO websites (name, local_folder, server_update_script) VALUES (?, ?, ?)',
          [name, local_folder, server_update_script],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      this.logUserAction(req.session.userId, 'create_website', name, req.ip);
      this.logger.info('Website created: ' + name + ' by user ' + req.session.userId);

      res.redirect('/publisher/admin/websites');
    } catch (error) {
      this.logger.error('Error creating website:', error);
      res.status(500).send('Failed to create website');
    }
  }

  async renderUsers(req, res) {
    try {
      const htmlServer = require('../common/html-server');
      const users = await this.getUsers();
      const websites = await this.getWebsites();

      let content = '<div class="row mb-4">';

      // Add user form
      content += '<div class="col-12 mb-4">';
      content += '<h3>Add New User</h3>';
      content += '<form method="post" action="/publisher/admin/users" class="row g-3">';
      content += '<div class="col-md-3">';
      content += '<label for="name" class="form-label">Full Name</label>';
      content += '<input type="text" class="form-control" id="name" name="name" required>';
      content += '</div>';
      content += '<div class="col-md-3">';
      content += '<label for="login" class="form-label">Username</label>';
      content += '<input type="text" class="form-control" id="login" name="login" required>';
      content += '</div>';
      content += '<div class="col-md-3">';
      content += '<label for="password" class="form-label">Password</label>';
      content += '<input type="password" class="form-control" id="password" name="password" required>';
      content += '</div>';
      content += '<div class="col-md-3 d-flex align-items-end">';
      content += '<div class="form-check">';
      content += '<input class="form-check-input" type="checkbox" id="is_admin" name="is_admin">';
      content += '<label class="form-check-label" for="is_admin">Administrator</label>';
      content += '</div>';
      content += '</div>';
      content += '<div class="col-12">';
      content += '<button type="submit" class="btn btn-primary">Add User</button>';
      content += '</div>';
      content += '</form>';
      content += '</div>';

      // Users list
      content += '<div class="col-12">';
      content += '<h3>Users & Permissions</h3>';

      if (users.length === 0) {
        content += '<p>No users found.</p>';
      } else {
        for (const user of users) {
          const permissions = await this.getUserPermissions(user.id);

          content += '<div class="card mb-3">';
          content += '<div class="card-header">';
          content += '<h5>' + user.name + ' (' + user.login + ') ' + (user.is_admin ? '<span class="badge bg-warning">Admin</span>' : '') + '</h5>';
          content += '</div>';
          content += '<div class="card-body">';

          if (websites.length === 0) {
            content += '<p>No websites available for permission assignment.</p>';
          } else {
            content += '<form method="post" action="/publisher/admin/permissions">';
            content += '<input type="hidden" name="user_id" value="' + user.id + '">';
            content += '<div class="permission-grid">';
            content += '<div><strong>Website</strong></div>';
            content += '<div><strong>Can Queue</strong></div>';
            content += '<div><strong>Can Approve</strong></div>';

            websites.forEach(website => {
              const perm = permissions.find(p => p.website_id === website.id) || {};
              content += '<div>' + website.name + '</div>';
              content += '<div>';
              content += '<input type="checkbox" name="queue_' + website.id + '"' + (perm.can_queue ? ' checked' : '') + '>';
              content += '</div>';
              content += '<div>';
              content += '<input type="checkbox" name="approve_' + website.id + '"' + (perm.can_approve ? ' checked' : '') + '>';
              content += '</div>';
            });

            content += '</div>';
            content += '<div class="mt-3">';
            content += '<button type="submit" class="btn btn-secondary btn-sm">Update Permissions</button>';
            content += '</div>';
            content += '</form>';
          }

          content += '</div>';
          content += '</div>';
        }
      }

      content += '</div>';
      content += '</div>';

      const html = htmlServer.renderPage('publisher', 'Users - FHIR Publisher', content);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      this.logger.error('Error rendering users:', error);
      res.status(500).send('Internal server error');
    }
  }

  async createUser(req, res) {
    try {
      const { name, login, password, is_admin } = req.body;

      const passwordHash = await bcrypt.hash(password, 10);

      await new Promise((resolve, reject) => {
        this.db.run(
          'INSERT INTO users (name, login, password_hash, is_admin) VALUES (?, ?, ?, ?)',
          [name, login, passwordHash, is_admin ? 1 : 0],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      this.logUserAction(req.session.userId, 'create_user', login, req.ip);
      this.logger.info('User created: ' + login + ' by user ' + req.session.userId);

      res.redirect('/publisher/admin/users');
    } catch (error) {
      this.logger.error('Error creating user:', error);
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(400).send('Username already exists');
      } else {
        res.status(500).send('Failed to create user');
      }
    }
  }

  async updatePermissions(req, res) {
    try {
      const { user_id } = req.body;
      const websites = await this.getWebsites();

      // Clear existing permissions
      await new Promise((resolve, reject) => {
        this.db.run('DELETE FROM user_website_permissions WHERE user_id = ?', [user_id], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Add new permissions
      for (const website of websites) {
        const canQueue = req.body['queue_' + website.id] === 'on';
        const canApprove = req.body['approve_' + website.id] === 'on';

        if (canQueue || canApprove) {
          await new Promise((resolve, reject) => {
            this.db.run(
              'INSERT INTO user_website_permissions (user_id, website_id, can_queue, can_approve) VALUES (?, ?, ?, ?)',
              [user_id, website.id, canQueue ? 1 : 0, canApprove ? 1 : 0],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }
      }

      this.logUserAction(req.session.userId, 'update_permissions', user_id, req.ip);
      res.redirect('/publisher/admin/users');
    } catch (error) {
      this.logger.error('Error updating permissions:', error);
      res.status(500).send('Failed to update permissions');
    }
  }

  // Helper methods
  async getTasks(limit = null) {
    return new Promise((resolve, reject) => {
      let sql = 'SELECT t.*, u.name as user_name, w.name as website_name, approver.name as approved_by_name FROM tasks t JOIN users u ON t.user_id = u.id JOIN websites w ON t.website_id = w.id LEFT JOIN users approver ON t.approved_by = approver.id ORDER BY t.queued_at DESC';

      if (limit) {
        sql += ' LIMIT ' + limit;
      }

      this.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async getTask(taskId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT t.*, u.name as user_name, w.name as website_name FROM tasks t JOIN users u ON t.user_id = u.id JOIN websites w ON t.website_id = w.id WHERE t.id = ?',
        [taskId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async getUserWebsites(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT w.* FROM websites w JOIN user_website_permissions p ON w.id = p.website_id WHERE p.user_id = ? AND p.can_queue = 1 AND w.is_active = 1',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  async userCanQueue(userId, websiteId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT can_queue FROM user_website_permissions WHERE user_id = ? AND website_id = ?',
        [userId, websiteId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row && row.can_queue);
        }
      );
    });
  }

  async userCanApprove(userId, websiteId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT can_approve FROM user_website_permissions WHERE user_id = ? AND website_id = ?',
        [userId, websiteId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row && row.can_approve);
        }
      );
    });
  }

  async findExistingTask(packageId, version) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM tasks WHERE npm_package_id = ? AND version = ? ORDER BY queued_at DESC LIMIT 1',
        [packageId, version],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async getWebsites() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM websites ORDER BY name', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async getUsers() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT id, name, login, is_admin, created_at FROM users ORDER BY name', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async getUserPermissions(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM user_website_permissions WHERE user_id = ?',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  getStatusColor(status) {
    const colors = {
      'queued': 'secondary',
      'building': 'warning',
      'waiting for approval': 'info',
      'publishing': 'warning',
      'complete': 'success',
      'failed': 'danger'
    };
    return colors[status] || 'secondary';
  }

  async logUserAction(userId, action, targetId, ipAddress) {
    return new Promise((resolve) => {
      this.db.run(
        'INSERT INTO user_actions (user_id, action, target_id, ip_address) VALUES (?, ?, ?, ?)',
        [userId, action, targetId, ipAddress],
        () => resolve() // Don't fail if logging fails
      );
    });
  }

  getStatus() {
    return {
      enabled: true,
      status: this.db ? 'Running' : 'Database not connected'
    };
  }

  async shutdown() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            this.logger.error('Error closing database:', err);
          }
          resolve();
        });
      });
    }
  }
}

module.exports = PublisherModule;