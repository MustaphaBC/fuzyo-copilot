import { useApp } from '../context/AppContext'
import CreateWorkspaceModal from './Workspace/CreateWorkspaceModal'

export default function WorkspaceModal() {
  const { workspaceModal, closeWorkspaceModal } = useApp()
  if (!workspaceModal.open) return null
  return <CreateWorkspaceModal onClose={closeWorkspaceModal} />
}
