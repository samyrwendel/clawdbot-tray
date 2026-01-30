Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$configPath = Join-Path $PSScriptRoot "config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

$form = New-Object System.Windows.Forms.Form
$form.Text = "Clawd Node - Configuracoes"
$form.Size = New-Object System.Drawing.Size(450, 540)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.TopMost = $true
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$y = 20

# Gateway Host
$lblHost = New-Object System.Windows.Forms.Label
$lblHost.Location = New-Object System.Drawing.Point(20, $y)
$lblHost.Size = New-Object System.Drawing.Size(120, 20)
$lblHost.Text = "Gateway Host:"
$form.Controls.Add($lblHost)

$txtHost = New-Object System.Windows.Forms.TextBox
$txtHost.Location = New-Object System.Drawing.Point(150, $y)
$txtHost.Size = New-Object System.Drawing.Size(180, 20)
$txtHost.Text = if ($config.gatewayHost) { $config.gatewayHost } else { "holdge.local" }
$form.Controls.Add($txtHost)

# Port
$lblPort = New-Object System.Windows.Forms.Label
$lblPort.Location = New-Object System.Drawing.Point(335, $y)
$lblPort.Size = New-Object System.Drawing.Size(15, 20)
$lblPort.Text = ":"
$form.Controls.Add($lblPort)

$txtPort = New-Object System.Windows.Forms.TextBox
$txtPort.Location = New-Object System.Drawing.Point(350, $y)
$txtPort.Size = New-Object System.Drawing.Size(60, 20)
$txtPort.Text = if ($config.gatewayPort) { $config.gatewayPort } else { "18789" }
$form.Controls.Add($txtPort)

$y += 35

# Password
$lblPassword = New-Object System.Windows.Forms.Label
$lblPassword.Location = New-Object System.Drawing.Point(20, $y)
$lblPassword.Size = New-Object System.Drawing.Size(120, 20)
$lblPassword.Text = "Senha:"
$form.Controls.Add($lblPassword)

$txtPassword = New-Object System.Windows.Forms.TextBox
$txtPassword.Location = New-Object System.Drawing.Point(150, $y)
$txtPassword.Size = New-Object System.Drawing.Size(260, 20)
$txtPassword.Text = $config.password
$txtPassword.UseSystemPasswordChar = $true
$form.Controls.Add($txtPassword)

$y += 35

# Node ID
$lblNodeId = New-Object System.Windows.Forms.Label
$lblNodeId.Location = New-Object System.Drawing.Point(20, $y)
$lblNodeId.Size = New-Object System.Drawing.Size(120, 20)
$lblNodeId.Text = "Node ID:"
$form.Controls.Add($lblNodeId)

$txtNodeId = New-Object System.Windows.Forms.TextBox
$txtNodeId.Location = New-Object System.Drawing.Point(150, $y)
$txtNodeId.Size = New-Object System.Drawing.Size(260, 20)
$txtNodeId.Text = $config.nodeId
$form.Controls.Add($txtNodeId)

$y += 35

# Node Name
$lblNodeName = New-Object System.Windows.Forms.Label
$lblNodeName.Location = New-Object System.Drawing.Point(20, $y)
$lblNodeName.Size = New-Object System.Drawing.Size(120, 20)
$lblNodeName.Text = "Nome do Node:"
$form.Controls.Add($lblNodeName)

$txtNodeName = New-Object System.Windows.Forms.TextBox
$txtNodeName.Location = New-Object System.Drawing.Point(150, $y)
$txtNodeName.Size = New-Object System.Drawing.Size(260, 20)
$txtNodeName.Text = $config.nodeName
$form.Controls.Add($txtNodeName)

$y += 35

# Reconnect Interval
$lblReconnect = New-Object System.Windows.Forms.Label
$lblReconnect.Location = New-Object System.Drawing.Point(20, $y)
$lblReconnect.Size = New-Object System.Drawing.Size(120, 20)
$lblReconnect.Text = "Reconectar (ms):"
$form.Controls.Add($lblReconnect)

$txtReconnect = New-Object System.Windows.Forms.TextBox
$txtReconnect.Location = New-Object System.Drawing.Point(150, $y)
$txtReconnect.Size = New-Object System.Drawing.Size(100, 20)
$txtReconnect.Text = $config.reconnectInterval
$form.Controls.Add($txtReconnect)

$y += 45

# Browser section
$grpBrowser = New-Object System.Windows.Forms.GroupBox
$grpBrowser.Location = New-Object System.Drawing.Point(20, $y)
$grpBrowser.Size = New-Object System.Drawing.Size(390, 100)
$grpBrowser.Text = "Browser (Playwright)"
$form.Controls.Add($grpBrowser)

$chkHeadless = New-Object System.Windows.Forms.CheckBox
$chkHeadless.Location = New-Object System.Drawing.Point(15, 25)
$chkHeadless.Size = New-Object System.Drawing.Size(200, 20)
$chkHeadless.Text = "Headless (sem janela)"
$chkHeadless.Checked = $config.browser.headless
$grpBrowser.Controls.Add($chkHeadless)

$lblExePath = New-Object System.Windows.Forms.Label
$lblExePath.Location = New-Object System.Drawing.Point(15, 55)
$lblExePath.Size = New-Object System.Drawing.Size(100, 20)
$lblExePath.Text = "Executavel:"
$grpBrowser.Controls.Add($lblExePath)

$txtExePath = New-Object System.Windows.Forms.TextBox
$txtExePath.Location = New-Object System.Drawing.Point(115, 52)
$txtExePath.Size = New-Object System.Drawing.Size(200, 20)
$txtExePath.Text = $config.browser.executablePath
$grpBrowser.Controls.Add($txtExePath)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Location = New-Object System.Drawing.Point(320, 50)
$btnBrowse.Size = New-Object System.Drawing.Size(55, 25)
$btnBrowse.Text = "..."
$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Filter = "Executaveis (*.exe)|*.exe"
    if ($dlg.ShowDialog() -eq "OK") {
        $txtExePath.Text = $dlg.FileName
    }
})
$grpBrowser.Controls.Add($btnBrowse)

$y += 115

# Status area
$grpStatus = New-Object System.Windows.Forms.GroupBox
$grpStatus.Location = New-Object System.Drawing.Point(20, $y)
$grpStatus.Size = New-Object System.Drawing.Size(390, 60)
$grpStatus.Text = "Status"
$form.Controls.Add($grpStatus)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Location = New-Object System.Drawing.Point(15, 22)
$lblStatus.Size = New-Object System.Drawing.Size(360, 30)
$lblStatus.Text = "Clique em Testar para verificar a conexao"
$lblStatus.ForeColor = [System.Drawing.Color]::Gray
$grpStatus.Controls.Add($lblStatus)

$y += 70

# Helper function to save config without BOM
function Save-ConfigNoBom($config, $path) {
    $json = $config | ConvertTo-Json -Depth 3
    [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
}

# Buttons
$btnTest = New-Object System.Windows.Forms.Button
$btnTest.Location = New-Object System.Drawing.Point(135, $y)
$btnTest.Size = New-Object System.Drawing.Size(85, 30)
$btnTest.Text = "Testar"
$btnTest.Add_Click({
    $newConfig = @{
        gatewayHost = $txtHost.Text
        gatewayPort = [int]$txtPort.Text
        gatewayUrl = "ws://" + $txtHost.Text + ":" + $txtPort.Text
        password = $txtPassword.Text
        nodeId = $txtNodeId.Text
        nodeName = $txtNodeName.Text
        reconnectInterval = [int]$txtReconnect.Text
        browser = @{
            headless = $chkHeadless.Checked
            executablePath = $txtExePath.Text
        }
    }
    # Preserva o token existente
    if ($config.token) {
        $newConfig.token = $config.token
    }

    $lblStatus.Text = "Salvando e reconectando..."
    $lblStatus.ForeColor = [System.Drawing.Color]::Orange
    $form.Refresh()

    # Limpa o status anterior para garantir que lemos o status do novo teste
    $statusPath = Join-Path $PSScriptRoot "status.txt"
    if (Test-Path $statusPath) {
        Remove-Item $statusPath -Force -ErrorAction SilentlyContinue
    }

    Save-ConfigNoBom $newConfig $configPath

    # Aguarda o app recarregar e tenta ler o status
    $timeout = 8
    $elapsed = 0

    while ($elapsed -lt $timeout) {
        Start-Sleep -Milliseconds 500
        $elapsed += 0.5
        $form.Refresh()

        if (Test-Path $statusPath) {
            try {
                $statusJson = Get-Content $statusPath -Raw -ErrorAction SilentlyContinue
                $status = $statusJson | ConvertFrom-Json

                switch ($status.status) {
                    "connected" {
                        $lblStatus.Text = "CONECTADO! $($status.details)"
                        $lblStatus.ForeColor = [System.Drawing.Color]::Green
                        return
                    }
                    "auth_failed" {
                        $lblStatus.Text = "FALHOU: $($status.details)"
                        $lblStatus.ForeColor = [System.Drawing.Color]::Red
                        return
                    }
                    "error" {
                        $lblStatus.Text = "ERRO: $($status.details)"
                        $lblStatus.ForeColor = [System.Drawing.Color]::Red
                        return
                    }
                    "connecting" {
                        $lblStatus.Text = "Conectando..."
                        $lblStatus.ForeColor = [System.Drawing.Color]::Orange
                    }
                    "authenticating" {
                        $lblStatus.Text = "Autenticando..."
                        $lblStatus.ForeColor = [System.Drawing.Color]::Orange
                    }
                    "auth_pending" {
                        $lblStatus.Text = "Aguardando resposta..."
                        $lblStatus.ForeColor = [System.Drawing.Color]::Orange
                    }
                    "disconnected" {
                        $lblStatus.Text = "Desconectado: $($status.details)"
                        $lblStatus.ForeColor = [System.Drawing.Color]::Red
                        return
                    }
                }
            } catch {
                # Ignore parse errors
            }
        }
    }

    $lblStatus.Text = "Timeout - verifique se o app esta rodando"
    $lblStatus.ForeColor = [System.Drawing.Color]::Gray
})
$form.Controls.Add($btnTest)

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Location = New-Object System.Drawing.Point(230, $y)
$btnSave.Size = New-Object System.Drawing.Size(85, 30)
$btnSave.Text = "Salvar"
$btnSave.Add_Click({
    $newConfig = @{
        gatewayHost = $txtHost.Text
        gatewayPort = [int]$txtPort.Text
        gatewayUrl = "ws://" + $txtHost.Text + ":" + $txtPort.Text
        password = $txtPassword.Text
        nodeId = $txtNodeId.Text
        nodeName = $txtNodeName.Text
        reconnectInterval = [int]$txtReconnect.Text
        browser = @{
            headless = $chkHeadless.Checked
            executablePath = $txtExePath.Text
        }
    }
    # Preserva o token existente
    if ($config.token) {
        $newConfig.token = $config.token
    }
    Save-ConfigNoBom $newConfig $configPath
    [System.Windows.Forms.MessageBox]::Show("Configuracoes salvas!", "Sucesso", "OK", "Information")
    $form.Close()
})
$form.Controls.Add($btnSave)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Location = New-Object System.Drawing.Point(325, $y)
$btnCancel.Size = New-Object System.Drawing.Size(85, 30)
$btnCancel.Text = "Cancelar"
$btnCancel.Add_Click({ $form.Close() })
$form.Controls.Add($btnCancel)

$form.AcceptButton = $btnSave
$form.CancelButton = $btnCancel

$form.Add_Shown({
    $form.Activate()
    $form.BringToFront()
})

[void]$form.ShowDialog()
